/**
 * scan/scanRuntime.ts
 *
 * `$scan` の drain 側の発火 — `from` と `resetOn`（docs/state-scan-design.md §2-1）。
 *
 * watch runtime の drain リスナー（`WATCH_LISTENER_PRIORITY`）から呼ばれる（D11）。
 * 発火対象集合・連鎖深さ・`prev` 台帳は `$watch` と共有する。
 *
 * 発火単位（D3）: バッチに載った `from` の絶対アドレス 1 つにつき fold 1 回。
 * 同じ出力へ複数行（wildcard）が載ったバッチでは、indexes 昇順に acc を連鎖させて
 * 最後に 1 回だけ書く。開始値と `Object.is` で同じなら書かない。
 * 行の着地は、いまのリストの位置 1 つにつき 1 回に絞る（watch/rowLanding.ts の selectLandedRows — `$watch` と共有）。
 *
 * 計画と書き込みを 2 相に分ける（D18）: 全 scan の次の値を読むだけで決め（planScansOnUpdateBatch）、
 * 宣言順に書く（commitScanPlans）。どちらも同じ drain の `$watch` の発火より前（D11）。
 * - 1 相で「畳んでは書く」と、ある scan の出力を `from` に取る後続の scan が、同じ drain で
 *   先行 scan が書いたばかりの（まだバッチとして届いていない）値を畳み、次のバッチで同じ値を
 *   もう一度畳む — 届いていた値は取りこぼす。宣言順しだいで exactly-once が破れる。
 * - 書き込みが `$watch` より前なので、同じ drain の `$watch` ハンドラは畳んで書いた後の出力を読み、ハンドラが
 *   出力へ書いた値はそのまま残る。その代わり、出力の source を drain のリスナーが書き進めて、出力の着地と
 *   source の新しい着地が同じバッチに載る連鎖では、出力を見る `$watch` の prev が前の着地を持ち、cur が
 *   1 段先行し、同じ値で 2 回発火し得る（D12 の契約・§5-6 の差し戻し）。
 *
 * 失敗は種類ごとに閉じる（D4）: 読めない行はその行だけを捨てて連鎖を続け（`$watch` が行ごとに
 * evaluate で閉じるのと同じ）、出力の読み・行の位置引き・fold の throw はその scan の書き込みを止める。
 */

import type { IAbsoluteStateAddress } from "../address/types";
import type { IStateElement } from "../components/types";
import { getScopedIndexes } from "../list/wildcardLevel";
import type { IStateProxy } from "../proxy/types";
import { getStreamEntries } from "../stream/streamRegistry";
import { getUpdater } from "../updater/updater";
import { beginWatchFiring, endWatchFiring } from "../watch/chainDepth";
import { getPrevValue } from "../watch/prevValues";
import { selectLandedRows } from "../watch/rowLanding";
import { consumePendingScanReset, discardPendingScanResets } from "./eventReset";
import { cloneInitial, isSameAsInitial, recordOutputValue } from "./initialValue";
import { isThenable, reportLateGetterSource, reportScanError, reportScanThenable, type ScanFailure } from "./scanReport";
import { getScanDrainGateCount, getScanRegistry } from "./scanRegistry";
import type { IScanEntry, IScanPathSource } from "./types";

export interface IScanRow {
  readonly absAddress: IAbsoluteStateAddress;
  readonly indexes: number[];
}

export interface IScanGroup {
  readonly stateElement: IStateElement;
  readonly entry: IScanEntry;
  readonly rows: IScanRow[];
  reset: boolean;
}

/** 相 1 の結果。`group.reset` なら相 2 が `initial` の複製を書く（出力が既に initial と同じ値なら書かない） */
export interface IScanPlan {
  readonly group: IScanGroup;
  readonly next: unknown;
}

const NO_PLANS: readonly IScanPlan[] = Object.freeze([]);

function groupOf(groups: Map<IScanEntry, IScanGroup>, stateElement: IStateElement, entry: IScanEntry): IScanGroup {
  let group = groups.get(entry);
  if (typeof group === "undefined") {
    group = { stateElement, entry, rows: [], reset: false };
    groups.set(entry, group);
  }
  return group;
}

/**
 * 同じ entry の行は wildcard の段数が同じ（indexes の長さが等しい）なので、
 * 外側の段から最初に違う段で比べる。
 */
function compareRows(a: IScanRow, b: IScanRow): number {
  let level = 0;
  while (level < a.indexes.length - 1 && a.indexes[level] === b.indexes[level]) {
    level++;
  }
  return a.indexes[level] - b.indexes[level];
}

/**
 * `from` の根が `$streams` 名で、そのバッチにその stream の restart 依存が載っているか（D10）。
 * 載っていれば同じ drain の STREAM リスナーが run を abort する。到着した chunk は
 * 捨てられる run のものなので畳まない（`$streams` §3-2「restart が勝つ」）。
 */
function isStreamRestartPending(
  stateElement: IStateElement,
  rootName: string,
  batch: ReadonlySet<IAbsoluteStateAddress>,
): boolean {
  const streamEntry = getStreamEntries(stateElement).get(rootName);
  if (typeof streamEntry === "undefined") {
    return false;
  }
  for (const dep of streamEntry.depAddresses) {
    if (batch.has(dep)) {
      return true;
    }
  }
  return false;
}

function hasGetterOnPath(stateElement: IStateElement, source: IScanPathSource): boolean {
  for (const path of source.pathInfo.cumulativePaths) {
    if (stateElement.getterPaths.has(path)) {
      return true;
    }
  }
  return false;
}

/** 先行する fold や書き込みが同期に切断・再セットを起こし得る（`$watch` と同じ再確認） */
function isLive(group: IScanGroup, activeStateElements: ReadonlySet<IStateElement>): boolean {
  return activeStateElements.has(group.stateElement)
    && getScanRegistry(group.stateElement)?.entries.has(group.entry) === true;
}

/**
 * 発火しないと決まった group の、`on` scan の保留 reset を捨てる（scan/eventReset.ts）。
 * `on` の group は `resetOn` のヒットからしか作られない。同じ `resetOn` のパスが次のバッチ向けに
 * 積まれていれば、その保留は次のバッチの drain が使うので残す（discardSkippedScanResets と同じ規則）。
 */
function dropPendingReset(group: IScanGroup): void {
  const { entry, stateElement } = group;
  if (entry.source.kind === "event" && !entry.resetOn.some((path) => isQueuedForNextBatch(stateElement, path))) {
    consumePendingScanReset(entry);
  }
}

/** 次のバッチ（まだ drain されていない書き込み）に、この state のこのパスが積まれているか */
function isQueuedForNextBatch(stateElement: IStateElement, path: string): boolean {
  return getUpdater().hasQueuedPath(stateElement, path);
}

/**
 * このバッチの scan を発火しない drain（発火対象でない state・連鎖深さの上限）で、`on` scan の
 * 保留 reset を捨てる。`firing` はこの drain で scan を発火する state の集合、null はバッチ全体を
 * 発火しない。同じ `resetOn` のパスが次のバッチ向けに積まれていれば、その保留は残す。
 */
export function discardSkippedScanResets(
  batch: ReadonlySet<IAbsoluteStateAddress>,
  firing: ReadonlySet<IStateElement> | null,
): void {
  discardPendingScanResets(batch, firing, isQueuedForNextBatch);
}

function readSource(state: IStateProxy, source: IScanPathSource, row: IScanRow): unknown {
  return source.pathInfo.wildcardCount === 0
    ? state[source.path]
    : state.$resolve(source.path, row.indexes);
}

/** 相 1: 次の値を読むだけで決める。書き込みは無いか null。 */
function planGroup(
  group: IScanGroup,
  batch: ReadonlySet<IAbsoluteStateAddress>,
  activeStateElements: ReadonlySet<IStateElement>,
): IScanPlan | null {
  if (!isLive(group, activeStateElements)) {
    dropPendingReset(group);
    return null;
  }
  const { stateElement, entry } = group;
  if (group.reset) {
    // reset が勝つ（D6）。同じバッチの行は畳まない
    return { group, next: entry.initial };
  }
  // reset でない group は `from` の行ヒットから作られている
  const source = entry.source as IScanPathSource;
  if (hasGetterOnPath(stateElement, source)) {
    reportLateGetterSource(entry, entry.name, source.path);
    return null;
  }
  if (isStreamRestartPending(stateElement, source.pathInfo.segments[0], batch)) {
    return null;
  }
  // コールバック内の代入は制御フロー解析に載らないので、結果と進み具合は入れ物で受け取る
  const result: { plan: IScanPlan | null; failure: ScanFailure } = { plan: null, failure: "read-output" };
  try {
    stateElement.createState("readonly", (state) => {
      const start = state[entry.name];
      // 行の位置引き（selectLandedRows）はリストを読むので throw しうる。出力の読みは
      // 済んでいるので、ここから先の失敗は `from` 側（read-rows）として報告する
      result.failure = "read-rows";
      const rows = source.pathInfo.wildcardCount === 0
        ? group.rows
        : selectLandedRows(state, source.pathInfo, group.rows);
      result.failure = "threw";
      const fold = entry.fold;
      let acc = start;
      for (const row of rows.sort(compareRows)) {
        let cur: unknown;
        try {
          cur = readSource(state, source, row);
        } catch (error) {
          // 読めない行だけを捨てて、残りの行の連鎖は続ける
          reportScanError(entry.name, error, "read-source");
          continue;
        }
        const next = fold(acc, cur, getPrevValue(row.absAddress), ...row.indexes);
        if (isThenable(next)) {
          reportScanThenable(entry.name, next);
          return;
        }
        acc = next;
      }
      if (!Object.is(acc, start)) {
        result.plan = { group, next: acc };
      }
    });
  } catch (error) {
    // 他の scan・`$watch`・`$streams` restart を巻き添えにしない（D4）
    reportScanError(entry.name, error, result.failure);
  }
  return result.plan;
}

/** 相 2 の 1 件: 書く直前に再確認する（後続の scan の fold が同期に切断・再セットし得る）。 */
function commitPlan(plan: IScanPlan, activeStateElements: ReadonlySet<IStateElement>): void {
  const { group } = plan;
  if (!isLive(group, activeStateElements)) {
    dropPendingReset(group);
    return;
  }
  const { stateElement, entry } = group;
  // `on` の reset は保留が残っているときだけ。書き込みの後に来た出来事が `initial` から
  // 畳んで保留を消していれば、その出力は reset 済み（scan/eventReset.ts）
  if (group.reset && entry.source.kind === "event" && !consumePendingScanReset(entry)) {
    return;
  }
  try {
    stateElement.createState("writable", (state) => {
      const current = state[entry.name];
      // reset は既に initial と同じ値なら書かない（着地も `$watch` の発火も起こさない）。書くときは複製を置く（D6 / D7）
      const writes = group.reset ? !isSameAsInitial(current, entry.initial) : !Object.is(current, plan.next);
      if (writes) {
        const next = group.reset ? cloneInitial(entry.initial) : plan.next;
        state[entry.name] = next;
        recordOutputValue(entry.name, next);
      }
    });
  } catch (error) {
    reportScanError(entry.name, error, "write");
  }
}

/**
 * 相 1: バッチの `from` / `resetOn` ヒットを集め、宣言順に次の値を決める（書かない）。
 * `depth` は watch runtime が消費した連鎖深さ。fold の中の書き込みも連鎖に数える。
 */
export function planScansOnUpdateBatch(
  batch: ReadonlySet<IAbsoluteStateAddress>,
  activeStateElements: ReadonlySet<IStateElement>,
  depth: number,
): readonly IScanPlan[] {
  // 発火対象でない state（書き込みの後に切断された）の `on` scan の保留 reset を捨てる（D6）。
  // drain のゲートより前に置く — 切断で最後の scan がゲートから外れても、その書き込みの保留は残っている
  discardSkippedScanResets(batch, activeStateElements);
  if (getScanDrainGateCount() === 0) {
    return NO_PLANS;
  }
  const groups = new Map<IScanEntry, IScanGroup>();
  for (const absAddress of batch) {
    const stateElement = absAddress.absolutePathInfo.stateElement;
    if (!activeStateElements.has(stateElement)) {
      continue;
    }
    const registry = getScanRegistry(stateElement);
    if (typeof registry === "undefined") {
      continue;
    }
    const pathInfo = absAddress.absolutePathInfo.pathInfo;
    const fromEntries = registry.byFromPath.get(pathInfo.path);
    if (typeof fromEntries !== "undefined") {
      let indexes: number[] = [];
      if (pathInfo.wildcardCount > 0) {
        if (absAddress.listIndex === null) {
          // 行が特定できないヒット（リストの依存展開で載る中間アドレス等）。`$watch` と同じく落とす
          continue;
        }
        indexes = getScopedIndexes(absAddress.listIndex, pathInfo.wildcardCount);
      }
      for (const entry of fromEntries) {
        groupOf(groups, stateElement, entry).rows.push({ absAddress, indexes });
      }
    }
    const resetEntries = registry.byResetPath.get(pathInfo.path);
    if (typeof resetEntries !== "undefined") {
      for (const entry of resetEntries) {
        groupOf(groups, stateElement, entry).reset = true;
      }
    }
  }
  if (groups.size === 0) {
    return NO_PLANS;
  }
  const ordered = Array.from(groups.values()).sort((a, b) => a.entry.order - b.entry.order);
  const plans: IScanPlan[] = [];
  beginWatchFiring(depth);
  try {
    for (const group of ordered) {
      const plan = planGroup(group, batch, activeStateElements);
      if (plan !== null) {
        plans.push(plan);
      }
    }
  } finally {
    endWatchFiring();
  }
  return plans;
}

/**
 * 相 2: 計画を宣言順に書く（D18）。同じ drain の `$watch` の発火より前（D11）。
 * scan の書き込みも連鎖深さに数える。
 */
export function commitScanPlans(
  plans: readonly IScanPlan[],
  activeStateElements: ReadonlySet<IStateElement>,
  depth: number,
): void {
  if (plans.length === 0) {
    return;
  }
  beginWatchFiring(depth);
  try {
    for (const plan of plans) {
      commitPlan(plan, activeStateElements);
    }
  } finally {
    endWatchFiring();
  }
}

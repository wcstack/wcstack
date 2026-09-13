/**
 * scan/scanRuntime.ts
 *
 * `$scan` の drain 側の発火 — `from` と `resetOn`（docs/state-scan-design.md §2-1）。
 *
 * watch runtime の drain リスナー（`WATCH_LISTENER_PRIORITY`）から、`$watch` の収集より
 * 前に呼ばれる（D11）。発火対象集合・連鎖深さ・`prev` 台帳は `$watch` と共有する。
 *
 * 発火単位（D3）: バッチに載った `from` の絶対アドレス 1 つにつき fold 1 回。
 * 同じ出力へ複数行（wildcard）が載ったバッチでは、indexes 昇順に acc を連鎖させて
 * 最後に 1 回だけ書く。開始値と `Object.is` で同じなら書かない。
 */

import type { IAbsoluteStateAddress } from "../address/types";
import type { IStateElement } from "../components/types";
import { getScopedIndexes } from "../list/wildcardLevel";
import { getStreamEntries } from "../stream/streamRegistry";
import { beginWatchFiring, endWatchFiring } from "../watch/chainDepth";
import { getPrevValue } from "../watch/prevValues";
import { isThenable, reportLateGetterSource, reportScanError, reportScanThenable } from "./scanReport";
import { getScanDrainRegistryCount, getScanRegistry } from "./scanRegistry";
import type { IScanEntry, IScanPathSource } from "./types";

interface IScanRow {
  readonly absAddress: IAbsoluteStateAddress;
  readonly indexes: number[];
}

interface IScanGroup {
  readonly stateElement: IStateElement;
  readonly entry: IScanEntry;
  readonly rows: IScanRow[];
  reset: boolean;
}

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

function fireGroup(
  group: IScanGroup,
  batch: ReadonlySet<IAbsoluteStateAddress>,
  activeStateElements: ReadonlySet<IStateElement>,
): void {
  const { stateElement, entry } = group;
  // 先行 fold の書き込みが同期に切断・再セットを起こし得る（`$watch` と同じ再確認）
  if (!activeStateElements.has(stateElement) || getScanRegistry(stateElement)?.entries.has(entry) !== true) {
    return;
  }
  try {
    stateElement.createState("writable", (state) => {
      if (group.reset) {
        // reset が勝つ（D6）。同じバッチの行は畳まない
        if (!Object.is(state[entry.name], entry.initial)) {
          state[entry.name] = entry.initial;
        }
        return;
      }
      // reset でない group は `from` の行ヒットから作られている
      const source = entry.source as IScanPathSource;
      if (hasGetterOnPath(stateElement, source)) {
        reportLateGetterSource(entry, entry.name, source.path);
        return;
      }
      if (isStreamRestartPending(stateElement, source.pathInfo.segments[0], batch)) {
        return;
      }
      const rows = group.rows.sort(compareRows);
      const fold = entry.fold;
      const start = state[entry.name];
      let acc = start;
      for (const row of rows) {
        const cur = source.pathInfo.wildcardCount === 0
          ? state[source.path]
          : state.$resolve(source.path, row.indexes);
        const next = fold(acc, cur, getPrevValue(row.absAddress), ...row.indexes);
        if (isThenable(next)) {
          reportScanThenable(entry.name, next);
          return;
        }
        acc = next;
      }
      if (!Object.is(acc, start)) {
        state[entry.name] = acc;
      }
    });
  } catch (error) {
    // 他の scan・`$watch`・`$streams` restart を巻き添えにしない（D4）
    reportScanError(entry.name, error);
  }
}

/**
 * バッチの `from` / `resetOn` ヒットを集めて、宣言順に発火する。
 * `depth` は watch runtime が消費した連鎖深さ。scan の書き込みも連鎖に数える。
 */
export function fireScansOnUpdateBatch(
  batch: ReadonlySet<IAbsoluteStateAddress>,
  activeStateElements: ReadonlySet<IStateElement>,
  depth: number,
): void {
  if (getScanDrainRegistryCount() === 0) {
    return;
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
    return;
  }
  const ordered = Array.from(groups.values()).sort((a, b) => a.entry.order - b.entry.order);
  beginWatchFiring(depth);
  try {
    for (const group of ordered) {
      fireGroup(group, batch, activeStateElements);
    }
  } finally {
    endWatchFiring();
  }
}

/**
 * scan/processScanDeclaration.ts
 *
 * `$scan: { <output>: { from | on, initial, fold, resetOn? } }` の解析と配線
 * （docs/state-scan-design.md §1-2 / §2-4）。
 *
 * `_state` セッター上の位置が違う 3 段に分ける:
 * 1. `parseScanDeclaration` — `value` だけを読む検査。世代を進める**前**に走るので、
 *    ここで throw した再セットは要素を丸ごと旧世代に残す。
 * 2. `materializeScanOutputs` / `subscribeScanEvents` — `clearEventTokenRegistry` の直後。
 *    実体化を `_rebuildPathInfo` より前に置くのは、前世代の `from`（別 scan の出力の子）を
 *    張り直すときに存在検査が偽の miss を出さないため。`on` の購読を `$on` より前に置くのは、
 *    同じトークンで reducer → effect の順にするため（D11）。
 * 3. `registerScans` — `processWatchDeclaration` の直前（`_pathSet` クリア後）。
 */

import { getPathInfo } from "../address/PathInfo";
import type { IPathInfo } from "../address/types";
import type { IStateElement } from "../components/types";
import { DELIMITER, MAX_WILDCARD_DEPTH, STATE_EVENT_TOKENS_NAME, STATE_SCAN_NAME, STATE_STREAMS_NAME, WILDCARD } from "../define";
import { didYouMean, LINT_HINT } from "../errorGuidance";
import { getOrCreateEventToken } from "../event/eventTokenRegistry";
import { getAllPropertyDescriptors } from "../getAllPropertyDescriptors";
import type { IStateProxy } from "../proxy/types";
import { raiseError } from "../raiseError";
import type { TokenSubscriber } from "../token/Token";
import type { IState } from "../types";
import { consumePendingScanReset, hasPendingScanReset } from "./eventReset";
import { isThenable, reportScanError, reportScanThenable, type ScanFailure } from "./scanReport";
import { setScanRegistry } from "./scanRegistry";
import type { IScanEntry, ScanFold, ScanSource } from "./types";

const INVALID = "[wcs/scan-declaration-invalid]";
const COMPUTED = "[wcs/scan-source-computed]";
const NO_RESET: readonly string[] = Object.freeze([]);

function entryLabel(name: string): string {
  return `${STATE_SCAN_NAME} entry "${name}"`;
}

/** 累積パス（`a` / `a.b` / `a.b.c`）のうち最初に getter であるものを返す */
function findGetterOnPath(pathInfo: IPathInfo, getterPaths: ReadonlySet<string>): string | null {
  for (const path of pathInfo.cumulativePaths) {
    if (getterPaths.has(path)) {
      return path;
    }
  }
  return null;
}

function computedMessage(label: string, field: string, path: string, getter: string): string {
  const where = getter === path ? "is a getter" : `is under the getter "${getter}"`;
  return `${COMPUTED} ${label} ${field} "${path}" ${where}. A getter re-evaluates whenever its inputs change, ` +
    `so folding it would count re-evaluations, not events. Fold the plain value the getter reads, or use "on" with an event token.${LINT_HINT}`;
}

function assertValidScanPath(label: string, field: string, path: string): IPathInfo {
  if (path.length === 0) {
    raiseError(`${INVALID} ${label} "${field}" must be a non-empty state path.${LINT_HINT}`);
  }
  if (path.startsWith("$")) {
    raiseError(`${INVALID} ${label} ${field} "${path}" must not start with "$" (reserved namespace).${LINT_HINT}`);
  }
  if (path.includes("@")) {
    raiseError(`${INVALID} ${label} ${field} "${path}" must not contain "@" — there is a single state tree per root.${LINT_HINT}`);
  }
  if (path in Object.prototype) {
    raiseError(`${INVALID} ${label} ${field} "${path}" must not be a property name inherited from Object.prototype (e.g. "__proto__", "constructor").`);
  }
  const pathInfo = getPathInfo(path);
  for (const segment of pathInfo.segments) {
    if (segment.length === 0) {
      raiseError(`${INVALID} ${label} ${field} "${path}" has an empty path segment.${LINT_HINT}`);
    }
  }
  if (pathInfo.wildcardCount > MAX_WILDCARD_DEPTH) {
    raiseError(`${INVALID} ${label} ${field} "${path}" exceeds the maximum wildcard depth (${MAX_WILDCARD_DEPTH}).`);
  }
  return pathInfo;
}

function collectStreamNames(state: IState): ReadonlySet<string> {
  const streams = (state as Record<string, unknown>)[STATE_STREAMS_NAME];
  if (typeof streams !== "object" || streams === null) {
    return new Set<string>();
  }
  return new Set(Object.keys(streams));
}

function assertOutputName(
  name: string,
  getterPaths: ReadonlySet<string>,
  setterPaths: ReadonlySet<string>,
  streamNames: ReadonlySet<string>,
): void {
  const label = entryLabel(name);
  if (name.length === 0) {
    raiseError(`${INVALID} ${STATE_SCAN_NAME} entry name must be a non-empty string.${LINT_HINT}`);
  }
  if (name.includes(DELIMITER) || name.includes(WILDCARD)) {
    raiseError(`${INVALID} ${label} must be a flat property name ("${DELIMITER}" and "${WILDCARD}" are not allowed). The output is a property the runtime owns.${LINT_HINT}`);
  }
  if (name.startsWith("$")) {
    raiseError(`${INVALID} ${label} must not start with "$" (reserved namespace).${LINT_HINT}`);
  }
  if (name in Object.prototype) {
    raiseError(`${INVALID} ${label} must not be a property name inherited from Object.prototype (e.g. "__proto__", "constructor").`);
  }
  if (getterPaths.has(name)) {
    raiseError(`${INVALID} ${label} conflicts with a getter declared on the state.${LINT_HINT}`);
  }
  if (setterPaths.has(name)) {
    raiseError(`${INVALID} ${label} conflicts with a setter declared on the state.${LINT_HINT}`);
  }
  if (streamNames.has(name)) {
    raiseError(`${INVALID} ${label} conflicts with the ${STATE_STREAMS_NAME} entry of the same name — each output has exactly one owner.${LINT_HINT}`);
  }
}

function parseSource(
  name: string,
  definition: Record<string, unknown>,
  eventTokenNames: ReadonlySet<string>,
  getterPaths: ReadonlySet<string>,
): ScanSource {
  const label = entryLabel(name);
  const hasFrom = typeof definition.from !== "undefined";
  const hasOn = typeof definition.on !== "undefined";
  if (hasFrom === hasOn) {
    raiseError(`${INVALID} ${label} must declare exactly one of "from" (a state path) or "on" (an event-token name).${LINT_HINT}`);
  }
  if (hasOn) {
    const tokenName = definition.on;
    if (typeof tokenName !== "string" || tokenName.length === 0) {
      raiseError(`${INVALID} ${label} "on" must be a non-empty event-token name.${LINT_HINT}`);
    }
    if (!eventTokenNames.has(tokenName)) {
      raiseError(`${INVALID} ${label} on "${tokenName}" is not declared in ${STATE_EVENT_TOKENS_NAME}.${didYouMean(tokenName, eventTokenNames)}${LINT_HINT}`);
    }
    return { kind: "event", tokenName };
  }
  const path = definition.from;
  if (typeof path !== "string") {
    raiseError(`${INVALID} ${label} "from" must be a state path string.${LINT_HINT}`);
  }
  const pathInfo = assertValidScanPath(label, "from", path);
  const getter = findGetterOnPath(pathInfo, getterPaths);
  if (getter !== null) {
    raiseError(computedMessage(label, "from", path, getter));
  }
  if (path === name || path.startsWith(name + DELIMITER)) {
    raiseError(`${INVALID} ${label} from "${path}" reads the entry's own output — the scan would fold its own writes forever.${LINT_HINT}`);
  }
  return { kind: "path", path, pathInfo };
}

function parseResetOn(
  name: string,
  raw: unknown,
  source: ScanSource,
  getterPaths: ReadonlySet<string>,
): readonly string[] {
  if (typeof raw === "undefined") {
    return NO_RESET;
  }
  const label = entryLabel(name);
  if (!Array.isArray(raw)) {
    raiseError(`${INVALID} ${label} "resetOn" must be an array of state paths.${LINT_HINT}`);
  }
  const paths: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      raiseError(`${INVALID} ${label} "resetOn" must contain only state path strings.${LINT_HINT}`);
    }
    const pathInfo = assertValidScanPath(label, "resetOn", item);
    if (pathInfo.wildcardCount > 0) {
      raiseError(`${INVALID} ${label} resetOn "${item}" must not contain "${WILDCARD}" — a reset returns the whole output to "initial".${LINT_HINT}`);
    }
    const getter = findGetterOnPath(pathInfo, getterPaths);
    if (getter !== null) {
      raiseError(computedMessage(label, "resetOn", item, getter));
    }
    if (source.kind === "path" && item === source.path) {
      raiseError(`${INVALID} ${label} resetOn "${item}" is the entry's own "from" — every change would reset instead of fold.${LINT_HINT}`);
    }
    // 子孫は死に設定: `from` を書くと依存展開で子孫も同じバッチに載り、reset が毎回勝つ。
    // 祖先（`from: "items.*.qty"` × `resetOn: ["items"]`）は「親の差し替えで作り直す」として通す
    if (source.kind === "path" && item.startsWith(source.path + DELIMITER)) {
      raiseError(`${INVALID} ${label} resetOn "${item}" sits under the entry's own "from" "${source.path}" — every write of "from" also lands it, so the reset would win every time and nothing would fold.${LINT_HINT}`);
    }
    paths.push(item);
  }
  return paths;
}

/**
 * scan 出力を介した参照の検査（エントリを跨ぐもの）:
 * - `resetOn` が scan 出力（自他とも）を読む ＝ 累積が累積を消すフィードバック。
 * - `from` の根を辿って scan 同士が循環する ＝ 互いの書き込みで永久に畳み合う。
 *   各 scan の `from` は 1 本なので、辿る先は高々 1 つ（関数グラフ）。
 */
function assertNoOutputReferences(entries: readonly IScanEntry[]): void {
  const outputs = new Set(entries.map((entry) => entry.name));
  const next = new Map<string, string>();
  for (const entry of entries) {
    for (const path of entry.resetOn) {
      const root = getPathInfo(path).segments[0];
      if (outputs.has(root)) {
        raiseError(`${INVALID} ${entryLabel(entry.name)} resetOn "${path}" reads the ${STATE_SCAN_NAME} output "${root}" — a reset driven by an accumulator is a feedback loop. Reset on the plain inputs instead.${LINT_HINT}`);
      }
    }
    if (entry.source.kind === "path") {
      const root = entry.source.pathInfo.segments[0];
      if (outputs.has(root)) {
        next.set(entry.name, root);
      }
    }
  }
  for (const start of next.keys()) {
    const chain = [start];
    let current = next.get(start);
    while (typeof current !== "undefined" && chain.length <= outputs.size) {
      if (current === start) {
        raiseError(`${INVALID} ${STATE_SCAN_NAME} entries ${[...chain, start].map((n) => `"${n}"`).join(" → ")} feed each other through "from" — each fold would re-trigger the next forever.${LINT_HINT}`);
      }
      chain.push(current);
      current = next.get(current);
    }
  }
}

/**
 * `$scan` 宣言の検査（`value` だけを読む）。宣言が無い・空なら null。
 *
 * getter / setter の判定は `value` の property descriptor から直接取る（`_getterPaths` は
 * この時点ではまだ旧世代のもの）。`$streams` 名との衝突も `value` の宣言から見る。
 */
export function parseScanDeclaration(
  state: IState,
  eventTokenNames: ReadonlySet<string>,
): readonly IScanEntry[] | null {
  const declared = (state as Record<string, unknown>)[STATE_SCAN_NAME];
  if (typeof declared === "undefined") {
    return null;
  }
  if (typeof declared !== "object" || declared === null || Array.isArray(declared)) {
    raiseError(`${INVALID} ${STATE_SCAN_NAME} must be an object mapping output names to scan definitions ({ from | on, initial, fold, resetOn? }).${LINT_HINT}`);
  }
  const getterPaths = new Set<string>();
  const setterPaths = new Set<string>();
  for (const [key, descriptor] of Object.entries(getAllPropertyDescriptors(state))) {
    if (typeof descriptor.get === "function") {
      getterPaths.add(key);
    }
    if (typeof descriptor.set === "function") {
      setterPaths.add(key);
    }
  }
  const streamNames = collectStreamNames(state);
  const entries: IScanEntry[] = [];
  let order = 0;
  for (const [name, def] of Object.entries(declared as Record<string, unknown>)) {
    assertOutputName(name, getterPaths, setterPaths, streamNames);
    if (typeof def !== "object" || def === null) {
      raiseError(`${INVALID} ${entryLabel(name)} must be an object ({ from | on, initial, fold, resetOn? }).${LINT_HINT}`);
    }
    const definition = def as Record<string, unknown>;
    const source = parseSource(name, definition, eventTokenNames, getterPaths);
    if (!("initial" in definition)) {
      raiseError(`${INVALID} ${entryLabel(name)} requires "initial" — the seed of the accumulator and the value "resetOn" returns to.${LINT_HINT}`);
    }
    if (typeof definition.fold !== "function") {
      raiseError(`${INVALID} ${entryLabel(name)} fold must be a function.${LINT_HINT}`);
    }
    const resetOn = parseResetOn(name, definition.resetOn, source, getterPaths);
    entries.push({
      name,
      source,
      fold: definition.fold as ScanFold,
      initial: definition.initial,
      resetOn,
      order: order++,
    });
  }
  assertNoOutputReferences(entries);
  return entries.length > 0 ? entries : null;
}

/**
 * 出力の実体化（設計書 D7）。未定義なら `initial` を置き、既に値があれば保持する
 * （同じオブジェクトの再セット・SSR ハイドレーションで累積を失わない）。
 */
export function materializeScanOutputs(state: IState, entries: readonly IScanEntry[]): void {
  for (const entry of entries) {
    if (!(entry.name in state)) {
      (state as Record<string, unknown>)[entry.name] = entry.initial;
    }
  }
}

function createEventFold(entry: IScanEntry): TokenSubscriber {
  const fold = entry.fold;
  return (state: unknown, event: unknown, ...indexes: unknown[]): void => {
    const proxy = state as IStateProxy;
    // 報告を「fold が throw した」と「出力を書けなかった」で分ける
    let failure: ScanFailure = "threw";
    try {
      const current = proxy[entry.name];
      // `resetOn` の書き込みより後の出来事は、reset 後の出力に畳む（scan/eventReset.ts）
      const reset = hasPendingScanReset(entry);
      const next = fold(reset ? entry.initial : current, event, ...indexes);
      if (isThenable(next)) {
        // 保留は残す — drain が出力を initial に戻す
        reportScanThenable(entry.name, next);
        return;
      }
      if (reset) {
        consumePendingScanReset(entry);
      }
      if (!Object.is(next, current)) {
        failure = "write";
        proxy[entry.name] = next;
      }
    } catch (error) {
      // 後続の subscriber（同じトークンの `$on`）を巻き添えにしない
      reportScanError(entry.name, error, failure);
    }
  };
}

/**
 * `on` の scan を event-token の subscriber として登録する（設計書 §2-2）。
 * 購読の寿命は `$on` と同じ（`clearEventTokenRegistry` で消える — Issue #273）。
 */
export function subscribeScanEvents(stateElement: IStateElement, entries: readonly IScanEntry[]): void {
  for (const entry of entries) {
    if (entry.source.kind === "event") {
      getOrCreateEventToken(stateElement, entry.source.tokenName).subscribe(createEventFold(entry));
    }
  }
}

/**
 * registry を作り、`from` / `resetOn` を依存グラフへ登録する。`from` パスの集合
 * （旧値キャプチャのゲート）を返す。無ければ null。
 *
 * 依存グラフ登録が要る理由は `$watch` と同じ（docs/state-watch-hook-design.md §8）:
 * `setPathInfo` はバインドからしか呼ばれないので、宣言しただけでは祖先への書き込みが
 * このパスへ展開されず、バッチに載らない。
 */
export function registerScans(stateElement: IStateElement, entries: readonly IScanEntry[]): ReadonlySet<string> | null {
  const registry = setScanRegistry(stateElement, entries);
  const fromPaths = new Set<string>();
  for (const path of registry.byFromPath.keys()) {
    fromPaths.add(path);
    stateElement.setPathInfo(path, "prop", "scan");
  }
  for (const path of registry.byResetPath.keys()) {
    stateElement.setPathInfo(path, "prop", "scan");
  }
  return fromPaths.size > 0 ? fromPaths : null;
}

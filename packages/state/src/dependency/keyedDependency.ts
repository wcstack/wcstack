/**
 * keyedDependency.ts — 鍵付き購読（`$eq(path, key)` / `$eqPath(path, keyPath)` / `$eqIndex(path, level)`）。
 *
 * 「`path` の値が鍵に等しいか」だけを知りたい getter は、`path` のパターン辺ではなく
 * その鍵の下に自分の行アドレスを登録する。`path` への書き込みは、旧値と新値の鍵に
 * 登録された行だけを dirty 化して enqueue する（パターン辺なら全行に展開されるところを
 * 高々 2 行に抑える。docs/state-next-major-tech-survey.md §10.1・§10.10、要件 N6 / D7）。
 *
 * - 行の購読は、差分がその行の listIndex を退役させた時点で落とす
 *   （`dropKeyedSubscriptionsByListIndex`、list/createListDiff.ts が呼ぶ）。差分が行を
 *   復活させたときは、getter の再評価が購読を張り直す。
 * - `$eqIndex` は行の index を鍵にする（getter を index 依存には記録しない）。段によって 2 通り:
 *   - 最内段（getter 自身の行の段）は行ごとの購読を持たず、リスト（listIndex 配列）単位の
 *     監視を 1 つ置く（`registerIndexWatcher`）。書き込みは `indexes[旧値]` と `indexes[新値]`
 *     の行を、差分は配列が変わったとき（`moveIndexWatchers`）「最後の値の位置にいた行と来た行」
 *     だけを enqueue する。移動行ごとの処理も退役時の解除も無い。
 *   - 外側の段は行ごとに index を鍵にして購読し、差分が index を付け替えるとき
 *     （syncListIndexes → `rekeyIndexSubscriptions`）に鍵も付け替える。移動した行は
 *     「`path` の最後の値が旧 index か新 index に等しい」ときだけ enqueue する。
 *   どちらも 1 行削除で再評価されるのは高々 2 行。
 * - `path` の最後の値は登録時と書き込み時に控える（差分側の判定に使う）。
 *
 * 不変条件: 同じ (アドレス, path) の購読は 1 つ。`keyByPathByAddress` が現在の鍵の正本で、
 * 台帳（`byPath`）とは常に一致する。退役した行のエントリは台帳・逆引きの両方から同時に消える。
 * 制約: Map の鍵比較は SameValueZero（`-0` と `+0` は同じ鍵、`NaN` 同士は同じ鍵）。
 */
import { IAbsoluteStateAddress, IPathInfo } from "../address/types";
import { createStateAddress } from "../address/StateAddress";
import { liftAddress } from "../address/liftAddress";
import { isRetiredListIndex } from "../list/listIndexesByList";
import { dirtyCacheEntryByAbsoluteStateAddress } from "../cache/cacheEntryByAbsoluteStateAddress";
import { IStateElement } from "../components/types";
import { IListIndex } from "../list/types";
import { getUpdater } from "../updater/updater";

type KeyMap = Map<unknown, Set<IAbsoluteStateAddress>>;
interface IElementLedger {
  readonly byPath: Map<string, KeyMap>;
  /** `path` の最後に見た値（登録時か書き込み時）。差分側の鍵付け替えが読む */
  readonly lastValue: Map<string, unknown>;
}
interface IEntry {
  readonly stateElement: IStateElement;
  readonly path: string;
  readonly absAddress: IAbsoluteStateAddress;
  /** `$eqIndex` のとき、index を鍵にしている段の listIndex（それ以外は null） */
  readonly levelListIndex: IListIndex | null;
}
const ledgerByElement = new WeakMap<IStateElement, IElementLedger>();
// アドレス → (path → 現在の鍵)。再評価した getter が購読を新しい鍵へ移すための逆引き
const keyByPathByAddress = new WeakMap<IAbsoluteStateAddress, Map<string, unknown>>();
// 行の listIndex にぶら下がる購読（退役時に落とす）
const entriesByListIndex = new WeakMap<IListIndex, IEntry[]>();
// index を鍵にしている購読を、その index の段の listIndex から引く（付け替え用）
const indexKeyedByListIndex = new WeakMap<IListIndex, IEntry[]>();
// 一度も登録が無ければ差分側のフックは Map 参照すら行わない
let anyRegistered = false;

/**
 * リスト単位の index 監視（`$eqIndex` の最内段）。行ごとの購読を持たず、書き込みは
 * `indexes[旧値]` と `indexes[新値]` の行を、差分は「最後の値の位置にいた行と来た行」だけを
 * enqueue する。差分がリストの listIndex 配列を作り直したら監視を新しい配列へ移す。
 */
interface IIndexWatcher {
  readonly stateElement: IStateElement;
  readonly path: string;
  /** 監視中のリストの listIndex 配列（差分で付け替わる） */
  indexes: IListIndex[];
  /** この監視を張った getter のパス（同じリストの複数 getter を 1 監視で扱う） */
  readonly getters: Set<IPathInfo>;
}
const watchersByElement = new WeakMap<IStateElement, Map<string, Set<IIndexWatcher>>>();
const watchersByIndexes = new WeakMap<IListIndex[], IIndexWatcher[]>();
const EMPTY: IAbsoluteStateAddress[] = [];

function ledgerOf(stateElement: IStateElement): IElementLedger {
  let ledger = ledgerByElement.get(stateElement);
  if (typeof ledger === "undefined") {
    ledgerByElement.set(stateElement, ledger = { byPath: new Map(), lastValue: new Map() });
  }
  return ledger;
}

function keyMapOf(ledger: IElementLedger, path: string): KeyMap {
  let keyMap = ledger.byPath.get(path);
  if (typeof keyMap === "undefined") {
    ledger.byPath.set(path, keyMap = new Map());
  }
  return keyMap;
}

function addToKey(keyMap: KeyMap, key: unknown, absAddress: IAbsoluteStateAddress): void {
  let set = keyMap.get(key);
  if (typeof set === "undefined") {
    keyMap.set(key, set = new Set());
  }
  set.add(absAddress);
}

/** 台帳へ登録する。既に同じ (アドレス, path) が登録済みなら鍵を移すだけで、false を返す */
function subscribe(ledger: IElementLedger, path: string, key: unknown, absAddress: IAbsoluteStateAddress): boolean {
  const keyMap = keyMapOf(ledger, path);
  let previous = keyByPathByAddress.get(absAddress);
  if (typeof previous === "undefined") {
    keyByPathByAddress.set(absAddress, previous = new Map());
  }
  if (previous.has(path)) {
    const oldKey = previous.get(path);
    if (!Object.is(oldKey, key)) {
      keyMap.get(oldKey)!.delete(absAddress);
      previous.set(path, key);
      addToKey(keyMap, key, absAddress);
    }
    return false;
  }
  previous.set(path, key);
  addToKey(keyMap, key, absAddress);
  return true;
}

function pushEntry(map: WeakMap<IListIndex, IEntry[]>, listIndex: IListIndex, entry: IEntry): void {
  const entries = map.get(listIndex);
  if (typeof entries === "undefined") {
    map.set(listIndex, [entry]);
  } else {
    entries.push(entry);
  }
}

function record(ledger: IElementLedger, path: string, current: unknown, absAddress: IAbsoluteStateAddress, isNew: boolean, entry: IEntry): void {
  ledger.lastValue.set(path, current);
  if (!isNew) {
    return;
  }
  // 行の外（トップレベルの getter）からの登録は listIndex を持たず、退役で落ちることもない
  if (absAddress.listIndex !== null) {
    pushEntry(entriesByListIndex, absAddress.listIndex, entry);
  }
  if (entry.levelListIndex !== null) {
    pushEntry(indexKeyedByListIndex, entry.levelListIndex, entry);
  }
}

/** `$eq` / `$eqPath`: 評価中の getter のアドレスを `key` の下に登録する。`current` は今読んだ `path` の値 */
export function registerKeyedDependency(
  stateElement: IStateElement,
  path: string,
  key: unknown,
  absAddress: IAbsoluteStateAddress,
  current: unknown,
): void {
  anyRegistered = true;
  const ledger = ledgerOf(stateElement);
  const isNew = subscribe(ledger, path, key, absAddress);
  record(ledger, path, current, absAddress, isNew, { stateElement, path, absAddress, levelListIndex: null });
}

/** `$eqIndex`: `levelListIndex.index` を鍵にして登録する。差分が index を変えたとき鍵も付け替える */
export function registerIndexKeyedDependency(
  stateElement: IStateElement,
  path: string,
  levelListIndex: IListIndex,
  absAddress: IAbsoluteStateAddress,
  current: unknown,
): void {
  anyRegistered = true;
  const ledger = ledgerOf(stateElement);
  const isNew = subscribe(ledger, path, levelListIndex.index, absAddress);
  record(ledger, path, current, absAddress, isNew, { stateElement, path, absAddress, levelListIndex });
}

export function hasKeyedDependents(stateElement: IStateElement, path: string): boolean {
  return ledgerByElement.get(stateElement)?.byPath.has(path) === true
    || watchersByElement.get(stateElement)?.has(path) === true;
}

/** `$eqIndex` の最内段: リスト（listIndex 配列）単位の監視を 1 つ登録し、getter のパスを足す */
export function registerIndexWatcher(
  stateElement: IStateElement,
  path: string,
  getterPathInfo: IPathInfo,
  indexes: IListIndex[],
  current: unknown,
): void {
  anyRegistered = true;
  ledgerOf(stateElement).lastValue.set(path, current);
  let byPath = watchersByElement.get(stateElement);
  if (typeof byPath === "undefined") {
    watchersByElement.set(stateElement, byPath = new Map());
  }
  let watchers = byPath.get(path);
  if (typeof watchers === "undefined") {
    byPath.set(path, watchers = new Set());
  }
  let byList = watchersByIndexes.get(indexes);
  let watcher: IIndexWatcher | undefined;
  if (typeof byList === "undefined") {
    watchersByIndexes.set(indexes, byList = []);
  } else {
    watcher = byList.find((w) => w.stateElement === stateElement && w.path === path);
  }
  if (typeof watcher === "undefined") {
    watcher = { stateElement, path, indexes, getters: new Set() };
    byList.push(watcher);
    watchers.add(watcher);
  }
  watcher.getters.add(getterPathInfo);
}

function watchedRowsAt(watcher: IIndexWatcher, key: unknown, out: IAbsoluteStateAddress[]): void {
  if (typeof key !== "number") {
    return;
  }
  const listIndex = watcher.indexes[key];
  if (typeof listIndex === "undefined") {
    return;
  }
  for (const getterPathInfo of watcher.getters) {
    out.push(liftAddress(watcher.stateElement, createStateAddress(getterPathInfo, listIndex)));
  }
}

/**
 * 差分がリストの listIndex 配列を `oldIndexes` → `newIndexes` に付け替えた: 監視を新しい配列へ移し、
 * `path` の最後の値の位置にいた行と来た行（違うときだけ）を dirty 化して enqueue する。
 * 同じ差分の 2 回目の呼び出し（キャッシュ命中）は旧配列に監視が無いので何もしない。
 */
export function moveIndexWatchers(oldIndexes: IListIndex[], newIndexes: IListIndex[]): void {
  if (!anyRegistered || oldIndexes === newIndexes) {
    return;
  }
  const watchers = watchersByIndexes.get(oldIndexes);
  if (typeof watchers === "undefined") {
    return;
  }
  watchersByIndexes.delete(oldIndexes);
  const existing = watchersByIndexes.get(newIndexes);
  watchersByIndexes.set(newIndexes, typeof existing === "undefined" ? watchers : existing.concat(watchers));
  for (const watcher of watchers) {
    watcher.indexes = newIndexes;
    const last = ledgerOf(watcher.stateElement).lastValue.get(watcher.path);
    if (typeof last !== "number") {
      continue;
    }
    const before = oldIndexes[last];
    const after = newIndexes[last];
    if (before === after) {
      continue;
    }
    for (const listIndex of [before, after]) {
      if (typeof listIndex === "undefined" || isRetiredListIndex(listIndex)) {
        continue;
      }
      for (const getterPathInfo of watcher.getters) {
        const absAddress = liftAddress(watcher.stateElement, createStateAddress(getterPathInfo, listIndex));
        dirtyCacheEntryByAbsoluteStateAddress(absAddress);
        getUpdater().enqueueAbsoluteAddress(absAddress, null);
      }
    }
  }
}

function collect(set: Set<IAbsoluteStateAddress> | undefined, out: IAbsoluteStateAddress[]): void {
  if (typeof set === "undefined") {
    return;
  }
  for (const address of set) {
    out.push(address);
  }
}

/**
 * `path` への書き込み: 旧値（同値ガードが読めたとき）と新値の鍵に登録された行アドレス。
 * 新値を `path` の最後の値として控える。呼び出し側は hasKeyedDependents で門を通す。
 */
export function keyedDependents(
  stateElement: IStateElement,
  path: string,
  hasOldKey: boolean,
  oldKey: unknown,
  newKey: unknown,
): IAbsoluteStateAddress[] {
  const ledger = ledgerByElement.get(stateElement);
  const keyMap = ledger?.byPath.get(path);
  const watchers = watchersByElement.get(stateElement)?.get(path);
  if (typeof ledger === "undefined" || (typeof keyMap === "undefined" && typeof watchers === "undefined")) {
    return EMPTY;
  }
  ledger.lastValue.set(path, newKey);
  const out: IAbsoluteStateAddress[] = [];
  const newDiffers = !hasOldKey || !Object.is(oldKey, newKey);
  if (typeof keyMap !== "undefined") {
    if (hasOldKey) {
      collect(keyMap.get(oldKey), out);
    }
    if (newDiffers) {
      collect(keyMap.get(newKey), out);
    }
  }
  if (typeof watchers !== "undefined") {
    for (const watcher of watchers) {
      if (hasOldKey) {
        watchedRowsAt(watcher, oldKey, out);
      }
      if (newDiffers) {
        watchedRowsAt(watcher, newKey, out);
      }
    }
  }
  return out;
}

function removeIndexEntry(entry: IEntry): void {
  const entries = indexKeyedByListIndex.get(entry.levelListIndex!)!;
  const at = entries.indexOf(entry);
  entries.splice(at, 1);
}

/** 差分が `listIndex` を退役させた: その行にぶら下がる購読を台帳と逆引きから落とす（復活した行は再評価で張り直す） */
export function dropKeyedSubscriptionsByListIndex(listIndex: IListIndex): void {
  if (!anyRegistered) {
    return;
  }
  const entries = entriesByListIndex.get(listIndex);
  if (typeof entries === "undefined") {
    return;
  }
  entriesByListIndex.delete(listIndex);
  for (const entry of entries) {
    const { stateElement, path, absAddress } = entry;
    const keys = keyByPathByAddress.get(absAddress)!;
    const key = keys.get(path);
    keys.delete(path);
    ledgerByElement.get(stateElement)!.byPath.get(path)!.get(key)!.delete(absAddress);
    if (entry.levelListIndex !== null) {
      removeIndexEntry(entry);
    }
  }
}

/**
 * 差分が `listIndex` の index を `oldIndex` → `newIndex` に変えた: その段を鍵にする `$eqIndex` の購読を
 * 新しい鍵へ移し、`path` の最後の値が旧 index か新 index に等しい行だけを dirty 化して enqueue する
 * （それ以外の移動行では `$eqIndex` の答えは変わらない）。syncListIndexes から、drain が差分を
 * 適用する前に呼ばれる。
 */
export function rekeyIndexSubscriptions(listIndex: IListIndex, oldIndex: number, newIndex: number): void {
  if (!anyRegistered) {
    return;
  }
  const entries = indexKeyedByListIndex.get(listIndex);
  if (typeof entries === "undefined") {
    return;
  }
  for (const { stateElement, path, absAddress } of entries) {
    const ledger = ledgerByElement.get(stateElement)!;
    const keyMap = ledger.byPath.get(path)!;
    keyMap.get(oldIndex)!.delete(absAddress);
    addToKey(keyMap, newIndex, absAddress);
    keyByPathByAddress.get(absAddress)!.set(path, newIndex);
    const last = ledger.lastValue.get(path);
    if (Object.is(last, oldIndex) || Object.is(last, newIndex)) {
      dirtyCacheEntryByAbsoluteStateAddress(absAddress);
      getUpdater().enqueueAbsoluteAddress(absAddress, null);
    }
  }
}

/** テスト用: この state で `path` の下に購読されている行アドレスの数 */
export function countKeyedSubscriptions(stateElement: IStateElement, path: string): number {
  const keyMap = ledgerByElement.get(stateElement)?.byPath.get(path);
  if (typeof keyMap === "undefined") {
    return 0;
  }
  let n = 0;
  for (const set of keyMap.values()) {
    n += set.size;
  }
  return n;
}

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
 * - `path` の最後の値は登録時と書き込み時に控える（差分側の判定に使う）。書き込みが旧値を
 *   読めなかったとき（オブジェクトの書き込みは同値ガードを通らない）は、これを旧い鍵として使う
 *   — 読めないまま新しい鍵の行だけを再評価すると、前に選ばれていた行が真のまま残る。
 * - `path` の祖先への書き込み（`$eq("sel.id")` に対する `sel = {…}`）は `path` への書き込みを
 *   経ないので、祖先 → 配下の鍵付きパスの逆引きを持ち、旧い親と新しい親から鍵を辿って知らせる
 *   （`keyedDescendantDependents`）。
 *
 * 不変条件: 同じ (アドレス, path) の購読は 1 つ。`keyByPathByAddress` が現在の鍵の正本で、
 * 台帳（`byPath`）とは常に一致する。退役した行のエントリは台帳・逆引きの両方から同時に消える。
 * 制約: Map の鍵比較は SameValueZero（`-0` と `+0` は同じ鍵、`NaN` 同士は同じ鍵）。
 */
import { IAbsoluteStateAddress, IPathInfo } from "../address/types";
import { getPathInfo } from "../address/PathInfo";
import { WILDCARD } from "../define";
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
  /** 祖先の逆引きに載せ終えた path */
  readonly recorded: Set<string>;
  /**
   * getter の評価中に呼ばれたが、`path` が getter かその下にあるので鍵付きで購読できず、追跡付きの
   * 読みに落ちた path。台帳の動作には使わず、DevTools の要約（要件 D17）だけが読む
   */
  readonly tracked: Set<string>;
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
 * リスト差分が enqueue した鍵付き購読者のアドレス。**依存ウォークの起点として使う分**。
 *
 * 書き込み起点の通知（`setByAddress` の `notifyKeyed`）は購読者から `walkDependency` を回して
 * 派生先まで届けるが（`walkKeyedDependents`）、差分起点の 2 経路（`moveIndexWatchers` /
 * `rekeyIndexSubscriptions`）は `createListDiff` から呼ばれ、そこには state proxy が無い
 * （ウォークはリスト展開で値を読む）。そこで**積むだけ**にして、proxy を持つ地点
 * （`walkDependency` の末尾）が引き取って回す。積む側は引き取り手を知らない。
 *
 * ツリー別に分ける理由が 2 つある。
 * - 引き取り手は自分のツリーしか辿れない（`walkDependency` は 1 ツリーの依存表と proxy で回る）。
 *   1 本の配列にすると、別ツリーのウォークが来たときに他人の分を取り出して**捨ててしまう**。
 * - 集合（Set）にしてあるので、引き取り手が来ないまま差分が続いても、溜まるのは
 *   「そのツリーの相異なる購読者アドレス」止まり（アドレスは intern 済み）。台帳が既に持っている
 *   分を超えない。
 *
 * `WeakMap` なので、ツリーが捨てられれば取り残しごと回収される。鍵付き購読を使わないページは
 * 積む側が `anyRegistered` で先に抜けるため、引き取り手の負担は `WeakMap#get` 1 回だけ。
 */
const pendingKeyedWalk = new WeakMap<IStateElement, Set<IAbsoluteStateAddress>>();

function pushPendingKeyedWalk(absAddress: IAbsoluteStateAddress): void {
  const stateElement = absAddress.absolutePathInfo.stateElement;
  let pending = pendingKeyedWalk.get(stateElement);
  if (typeof pending === "undefined") {
    pendingKeyedWalk.set(stateElement, pending = new Set());
  }
  pending.add(absAddress);
}

/** このツリーに積まれた起点を取り出す（無ければ null）。引き取り手は proxy を持っている地点だけ */
export function takePendingKeyedWalk(stateElement: IStateElement): Set<IAbsoluteStateAddress> | null {
  const pending = pendingKeyedWalk.get(stateElement);
  if (typeof pending === "undefined") {
    return null;
  }
  pendingKeyedWalk.delete(stateElement);
  return pending;
}

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
/**
 * 祖先の listIndex → その配下で購読を持つ行の listIndex。
 *
 * 入れ子リストの**親行**が退役しても、子のリスト（`groups.*.rows`）には差分が来ない — 配列ごと
 * 捨てられるだけなので `dropKeyedSubscriptionsByListIndex` が子には呼ばれず、台帳の強参照
 * （`ledger.byPath` の `Set<IAbsoluteStateAddress>`）が残る。`IListIndex` は `parentListIndex`
 * （上向き）しか持たないので、登録の時点で祖先の側に自分を載せて逆引きを作る。
 *
 * 集合の中身は強参照だが、**祖先が生きている間だけ**（WeakMap）で、行が落ちるときは
 * `unlinkAncestors` で外れる。祖先自身が回収されれば集合ごと消える。
 */
const descendantRowsByAncestor = new WeakMap<IListIndex, Set<IListIndex>>();
/** `$eqIndex` 最内段の監視 → それが載っているリストの親行（親の退役で監視ごと落とす） */
const watchersByOwnerListIndex = new WeakMap<IListIndex, Set<IIndexWatcher>>();
// 祖先パス → その配下の鍵付きパス（祖先への書き込みを配下の鍵付き購読へ届ける）
const descendantsByElement = new WeakMap<IStateElement, Map<string, Set<string>>>();
const EMPTY: IAbsoluteStateAddress[] = [];

/** `path` の祖先を逆引きに載せる（同じ path は 1 回だけ）。祖先の無いトップレベルの path は載せない */
function recordAncestors(stateElement: IStateElement, path: string): void {
  const ledger = ledgerOf(stateElement);
  if (ledger.recorded.has(path)) {
    return;
  }
  ledger.recorded.add(path);
  const cumulativePaths = getPathInfo(path).cumulativePaths;
  if (cumulativePaths.length < 2) {
    return;
  }
  let byAncestor = descendantsByElement.get(stateElement);
  if (typeof byAncestor === "undefined") {
    descendantsByElement.set(stateElement, byAncestor = new Map());
  }
  for (let i = 0; i < cumulativePaths.length - 1; i++) {
    let descendants = byAncestor.get(cumulativePaths[i]);
    if (typeof descendants === "undefined") {
      byAncestor.set(cumulativePaths[i], descendants = new Set());
    }
    descendants.add(path);
  }
}

function ledgerOf(stateElement: IStateElement): IElementLedger {
  let ledger = ledgerByElement.get(stateElement);
  if (typeof ledger === "undefined") {
    ledgerByElement.set(stateElement, ledger = { byPath: new Map(), lastValue: new Map(), recorded: new Set(), tracked: new Set() });
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

/** 鍵から行を外し、空になった鍵は Map から消す（オブジェクトの鍵を行の退役後まで握らない） */
function removeFromKey(keyMap: KeyMap, key: unknown, absAddress: IAbsoluteStateAddress): void {
  const set = keyMap.get(key)!;
  set.delete(absAddress);
  if (set.size === 0) {
    keyMap.delete(key);
  }
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
      removeFromKey(keyMap, oldKey, absAddress);
      previous.set(path, key);
      addToKey(keyMap, key, absAddress);
    }
    return false;
  }
  previous.set(path, key);
  addToKey(keyMap, key, absAddress);
  return true;
}

/** 追加して「この listIndex の最初のエントリだったか」を返す（祖先への登録は行ごとに 1 回でよい） */
function pushEntry(map: WeakMap<IListIndex, IEntry[]>, listIndex: IListIndex, entry: IEntry): boolean {
  const entries = map.get(listIndex);
  if (typeof entries === "undefined") {
    map.set(listIndex, [entry]);
    return true;
  }
  entries.push(entry);
  return false;
}

/**
 * 行を祖先の逆引きへ載せる / から外す。深さぶんのループで、鍵付き購読を持つ行の登録と退役でしか
 * 走らない（`$eq` 系を使わないページは 1 回も通らない）。
 *
 * 祖先は `listIndexes`（WeakRef 配列）ではなく `parentListIndex` を辿る。`parentListIndex` は
 * 強参照なので、自分が生きていれば祖先も生きている ＝ `deref()` の空振りを考えなくてよく、
 * `listIndexes` getter の再構築（`reparent` の世代が変わると配列を作り直す）も踏まない。
 *
 * **不変条件: 購読を持つ行は、生きたまま別の親へ付け替えられない。** チェーンを記録するのは
 * 「その行の最初の購読」の 1 回だけで、外すのは行が落ちるときだけなので、途中で
 * `reparentListIndex`（`list/listIndexesByList.ts` の `getRepairTarget`。第 1 分岐は**旧親が
 * 退役していなくても** `home` へ付け替えうる）が走ると逆引きは古い親を指したまま残る。
 * 破れると 2 方向に壊れる:
 *   (a) 旧親の退役が、**生きている**行の購読を落とす（選択が効かなくなる）
 *   (b) 実親の退役が子を落とし損ねる（＝この逆引きが塞いだリークの再発）
 * 破れていないことは `__tests__/dependency.keyedAncestorIndex.test.ts` が検査している
 * （記録した祖先が今も `parentListIndex` チェーン上に居るかの突き合わせ）。付け替えを
 * 許す必要が出たら、`reparentListIndex` から `unlinkAncestors` → `linkAncestors` を
 * 張り直す形にするのが構造的に強い。
 */
function linkAncestors(listIndex: IListIndex): void {
  for (let ancestor = listIndex.parentListIndex; ancestor !== null; ancestor = ancestor.parentListIndex) {
    let rows = descendantRowsByAncestor.get(ancestor);
    if (typeof rows === "undefined") {
      descendantRowsByAncestor.set(ancestor, rows = new Set());
    }
    rows.add(listIndex);
  }
}

function unlinkAncestors(listIndex: IListIndex): void {
  for (let ancestor = listIndex.parentListIndex; ancestor !== null; ancestor = ancestor.parentListIndex) {
    const rows = descendantRowsByAncestor.get(ancestor);
    // 祖先ごと退役した場合は、`dropKeyedSubscriptionsByListIndex` が先に集合を外している
    if (typeof rows === "undefined") {
      continue;
    }
    rows.delete(listIndex);
    if (rows.size === 0) {
      descendantRowsByAncestor.delete(ancestor);
    }
  }
}

function record(ledger: IElementLedger, path: string, current: unknown, absAddress: IAbsoluteStateAddress, isNew: boolean, entry: IEntry): void {
  ledger.lastValue.set(path, current);
  if (!isNew) {
    return;
  }
  // 行の外（トップレベルの getter）からの登録は listIndex を持たず、退役で落ちることもない
  if (absAddress.listIndex !== null) {
    if (pushEntry(entriesByListIndex, absAddress.listIndex, entry)) {
      // この行の最初の購読。祖先の逆引きへ 1 回だけ載せる
      linkAncestors(absAddress.listIndex);
    }
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
  recordAncestors(stateElement, path);
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
  recordAncestors(stateElement, path);
  const isNew = subscribe(ledger, path, levelListIndex.index, absAddress);
  record(ledger, path, current, absAddress, isNew, { stateElement, path, absAddress, levelListIndex });
}

/** getter の評価中の `$eq` / `$eqPath` / `$eqIndex` が、`path` が getter 由来のため追跡付きの読みに落ちた */
export function recordTrackedKeyedPath(stateElement: IStateElement, path: string): void {
  ledgerOf(stateElement).tracked.add(path);
}

/** DevTools の要約（devtools/keyedSubscriptions.ts）が読む、この state の台帳。読むだけで変えない */
export interface IKeyedLedgerView {
  readonly byPath: ReadonlyMap<string, ReadonlyMap<unknown, ReadonlySet<IAbsoluteStateAddress>>>;
  readonly lastValue: ReadonlyMap<string, unknown>;
  readonly tracked: ReadonlySet<string>;
  /** `$eqIndex` の最内段のリスト単位の監視（path → 監視） */
  readonly watchers: ReadonlyMap<string, ReadonlySet<unknown>> | undefined;
}

export function getKeyedLedgerView(stateElement: IStateElement): IKeyedLedgerView | null {
  const ledger = ledgerByElement.get(stateElement);
  if (typeof ledger === "undefined") {
    return null;
  }
  return { byPath: ledger.byPath, lastValue: ledger.lastValue, tracked: ledger.tracked, watchers: watchersByElement.get(stateElement) };
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
  recordAncestors(stateElement, path);
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
    // 入れ子リストの監視は、そのリストを抱える**親行**に紐づける。親が退役すると
    // この配列には差分が来ない（配列ごと捨てられる）ので、ここで持ち主を控えておかないと
    // `watchersByElement` に死んだ監視が積み上がる。トップレベルのリスト（親が null）は
    // 孤児にならないので紐づけない
    const owner = indexes[0]?.parentListIndex ?? null;
    if (owner !== null) {
      let owned = watchersByOwnerListIndex.get(owner);
      if (typeof owned === "undefined") {
        watchersByOwnerListIndex.set(owner, owned = new Set());
      }
      owned.add(watcher);
    }
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
        pushPendingKeyedWalk(absAddress);
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
 * 控えていた最後の値が旧値と違う（旧値を読めなかった）ときは、その鍵の行も加える。
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
  const hasLast = ledger.lastValue.has(path);
  const last = ledger.lastValue.get(path);
  ledger.lastValue.set(path, newKey);
  const out: IAbsoluteStateAddress[] = [];
  const newDiffers = !hasOldKey || !Object.is(oldKey, newKey);
  // 行が最後に見た値。旧値を読めなかったときに真のまま残る行はここにいる
  const lastDiffers = hasLast && (!hasOldKey || !Object.is(last, oldKey)) && !Object.is(last, newKey);
  if (typeof keyMap !== "undefined") {
    if (hasOldKey) {
      collect(keyMap.get(oldKey), out);
    }
    if (lastDiffers) {
      collect(keyMap.get(last), out);
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
      if (lastDiffers) {
        watchedRowsAt(watcher, last, out);
      }
      if (newDiffers) {
        watchedRowsAt(watcher, newKey, out);
      }
    }
  }
  return out;
}

export function hasKeyedDescendants(stateElement: IStateElement, path: string): boolean {
  return descendantsByElement.get(stateElement)?.has(path) === true;
}

/** `value` から `segments` を辿った値（途中がオブジェクトでなければ undefined） */
function valueAt(value: unknown, segments: readonly string[]): unknown {
  let current = value;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * `path`（鍵付きパスの祖先）への書き込み: 配下の鍵付きパスごとに、旧い親と新しい親から鍵を辿り、
 * その鍵の行を返す（`keyedDependents` と同じ扱い）。残りのパスにワイルドカードがあると行ごとの鍵が
 * 辿れないので、そのパスに購読している行をすべて返す。呼び出し側は hasKeyedDescendants で門を通す。
 */
export function keyedDescendantDependents(
  stateElement: IStateElement,
  path: string,
  oldValue: unknown,
  newValue: unknown,
  hasOldValue: boolean = true,
): IAbsoluteStateAddress[] {
  const depth = getPathInfo(path).segments.length;
  const out: IAbsoluteStateAddress[] = [];
  for (const descendant of descendantsByElement.get(stateElement)!.get(path)!) {
    const rest = getPathInfo(descendant).segments.slice(depth);
    if (rest.includes(WILDCARD)) {
      allDependents(stateElement, descendant, out);
      continue;
    }
    // `hasOldValue` が偽なのは `$postUpdate`（in-place 変異の通知 — 旧い親がどこにも無い）。
    // 旧い鍵は台帳の `lastValue` から引かせる（`keyedDependents` の lastDiffers 経路）
    const oldKey = hasOldValue ? valueAt(oldValue, rest) : undefined;
    for (const address of keyedDependents(stateElement, descendant, hasOldValue, oldKey, valueAt(newValue, rest))) {
      out.push(address);
    }
  }
  return out;
}

/** `path` に鍵付きで購読しているすべての行 */
function allDependents(stateElement: IStateElement, path: string, out: IAbsoluteStateAddress[]): void {
  const keyMap = ledgerByElement.get(stateElement)!.byPath.get(path);
  if (typeof keyMap !== "undefined") {
    for (const set of keyMap.values()) {
      collect(set, out);
    }
  }
  const watchers = watchersByElement.get(stateElement)?.get(path);
  if (typeof watchers !== "undefined") {
    for (const watcher of watchers) {
      for (let index = 0; index < watcher.indexes.length; index++) {
        watchedRowsAt(watcher, index, out);
      }
    }
  }
}

function removeIndexEntry(entry: IEntry): void {
  const entries = indexKeyedByListIndex.get(entry.levelListIndex!)!;
  const at = entries.indexOf(entry);
  entries.splice(at, 1);
}

/** 1 行ぶんの購読を台帳と逆引きから落とす */
function dropRowSubscriptions(listIndex: IListIndex): void {
  const entries = entriesByListIndex.get(listIndex);
  if (typeof entries === "undefined") {
    return;
  }
  entriesByListIndex.delete(listIndex);
  // 生きている親の下で行が出入りする形（単層リストの削除）でも、祖先の集合に死んだ行を
  // 残さない
  unlinkAncestors(listIndex);
  for (const entry of entries) {
    const { stateElement, path, absAddress } = entry;
    const keys = keyByPathByAddress.get(absAddress)!;
    const key = keys.get(path);
    keys.delete(path);
    removeFromKey(ledgerByElement.get(stateElement)!.byPath.get(path)!, key, absAddress);
    if (entry.levelListIndex !== null) {
      removeIndexEntry(entry);
    }
  }
}

/** `listIndex` が親として抱えていたリストの `$eqIndex` 監視を落とす */
function dropWatchersOwnedBy(listIndex: IListIndex): void {
  const owned = watchersByOwnerListIndex.get(listIndex);
  if (typeof owned === "undefined") {
    return;
  }
  watchersByOwnerListIndex.delete(listIndex);
  for (const watcher of owned) {
    // 台帳の不変条件で必ず引ける: 監視を入れるのは `registerIndexWatcher` だけで両方へ同時に入れ、
    // 抜くのはここと `moveIndexWatchers`（`watcher.indexes` と `watchersByIndexes` を同時に
    // 付け替える）だけ。`dropRowSubscriptions` 側と同じく `!` で不変条件を宣言する
    const byPath = watchersByElement.get(watcher.stateElement)!;
    const watchers = byPath.get(watcher.path)!;
    watchers.delete(watcher);
    if (watchers.size === 0) {
      byPath.delete(watcher.path);
    }
    const byList = watchersByIndexes.get(watcher.indexes)!;
    byList.splice(byList.indexOf(watcher), 1);
    if (byList.length === 0) {
      watchersByIndexes.delete(watcher.indexes);
    }
  }
}

/**
 * 差分が `listIndex` を退役させた: その行にぶら下がる購読を台帳と逆引きから落とす
 * （復活した行は再評価で張り直す）。
 *
 * **入れ子リストの子孫も一緒に落とす。** 親が退役しても子のリストには差分が来ない
 * （配列ごと捨てられる）ので、ここで辿らないと子行の購読が台帳に残り続ける —
 * 描画は正しい（updater が dead アドレスを弾く）が、強参照のリークであり、D17 の
 * pull API が「4 行のページで rows 20」という嘘を返す。
 * 逆引きは**全段の祖先**に載せてあるので、再帰せずここで一度に落とせる。
 */
export function dropKeyedSubscriptionsByListIndex(listIndex: IListIndex): void {
  if (!anyRegistered) {
    return;
  }
  dropRowSubscriptions(listIndex);
  dropWatchersOwnedBy(listIndex);
  const descendants = descendantRowsByAncestor.get(listIndex);
  if (typeof descendants === "undefined") {
    return;
  }
  // `unlinkAncestors` が回している間に同じ集合を触るので、先に切り離す
  descendantRowsByAncestor.delete(listIndex);
  for (const descendant of descendants) {
    dropRowSubscriptions(descendant);
    dropWatchersOwnedBy(descendant);
    descendantRowsByAncestor.delete(descendant);
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
    removeFromKey(keyMap, oldIndex, absAddress);
    addToKey(keyMap, newIndex, absAddress);
    keyByPathByAddress.get(absAddress)!.set(path, newIndex);
    const last = ledger.lastValue.get(path);
    if (Object.is(last, oldIndex) || Object.is(last, newIndex)) {
      dirtyCacheEntryByAbsoluteStateAddress(absAddress);
      getUpdater().enqueueAbsoluteAddress(absAddress, null);
      pushPendingKeyedWalk(absAddress);
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

/**
 * list/stateListBaseline.ts
 *
 * state 側のリスト差分基準 — 「最後に **state 側が観測した** リスト値」。
 *
 * 描画側の基準（[lastListValueByAbsoluteStateAddress](./lastListValueByAbsoluteStateAddress.ts)）
 * とは別の問いに答える台帳である。あちらは「最後に**描画した**値」で、`applyChangeToFor` が
 * 「画面に対して何を足し引きするか」を決めるために使う。こちらは読み（`$getAll`）と
 * 依存ウォーク（`walkDependency`）が「**前回見た形からどう変わったか**」を決めるために使う。
 *
 * 統合してはならない。ウォークが描画側の基準を進めると、その後の `applyChangeToFor` が
 * 空の差分を見て描画を落とす。逆に描画側の基準だけに頼ると、`for` バインドの無いリストでは
 * 基準が永久に空のままになり、`createListDiff` の「旧リストが空」分岐が新しい配列に
 * **新しい ListIndex を鋳造**する。子リストの台帳は旧親 ListIndex を指したまま残るので
 * 親子の連鎖が切れ、集計が恒久的に stale になるか `ListIndexes not found` で恒久的に
 * throw する（docs/state-recursive-path-impl-plan.md §3-2 の E1）。
 *
 * 書き手は 5 系統ある。いずれも「観測した」という同じ意味を持つ。
 * - 読み: `collectWildcardIndexes`（`commitDiffBaseline: true` のときだけ。固定 arity の
 *   `$setAll` は走査を借りるだけで動かさない — docs/state-set-all-design.md §6-2）
 * - 再帰の走査: `recursion/walk.ts`（合併形の `$getAll` と**再帰の `$setAll` の両方**が確定する。
 *   cold な書き込みが ListIndex 世代を鋳造したまま基準を残すと、次の構造変更で深い子台帳が
 *   孤児になるため — docs/state-recursive-path-impl-plan.md §6）
 * - 描画: `applyChangeFromBindings` / `hydrateBindings`（描画側の基準と同時に書く）
 * - 依存ウォーク: `walkDependency`（ウォーク完了後にまとめて確定する）
 * - 添字から行を引く経路（直接添字・`$postUpdate`・`$resolve` / `$setAll` の行の引き直し —
 *   proxy/methods/getListIndexesByAddress.ts）: 台帳の無いリストに台帳を生やしたときだけ（#324）。
 *   生やした行を基準に載せないと、描いていないリストを写し替えたときに行が退役せず、子リストの
 *   台帳が古い行にぶら下がったまま残る
 *
 * キーは **絶対アドレス**。`IStateAddress` は listIndex が null のとき pathInfo だけで
 * intern されるため、同じパス形状のルートリストを持つ 2 つの state 要素がエントリを
 * 共有してしまう（`createStateAddress` の `_cacheNullListIndex`）。
 */
import { IAbsoluteStateAddress } from "../address/types";

const stateListBaselineByAbsoluteStateAddress: WeakMap<IAbsoluteStateAddress, readonly unknown[]> = new WeakMap();
/**
 * 更新バッチ中の観測は**即座に確定しない**。バッチ内で同じリストへ 2 回構造書き込みすると、
 * 2 回目のウォークが「一度も描画されず直後に上書きされる中間値」を基準に diff を取り、
 * 中間値が落とした行の ListIndex が鋳造し直されて子リストの台帳が恒久的に切れるため。
 *
 * バッチが開いている間の観測はここに溜め、バッチ末尾（updater の drain 終了）でまとめて
 * 確定する。こうするとバッチ内のどのウォークも「バッチ開始時の値」と diff を取り、
 * これは描画側（applyChangeToFor が描画基準で取る diff）と一致する。
 *
 * 深さで数えるのは、drain の最中に $updatedCallback などが書いて新しいバッチが
 * 始まる形があるため。0 に戻ったバッチだけが確定する。
 */
let pendingBaselines: Map<IAbsoluteStateAddress, readonly unknown[]> | null = null;
let batchDepth = 0;

export function getStateListBaseline(address: IAbsoluteStateAddress): readonly unknown[] {
  // pending は意図的に見ない。バッチ中の読み手には「バッチ開始時の値」を返す。
  return stateListBaselineByAbsoluteStateAddress.get(address) ?? [];
}

export function setStateListBaseline(address: IAbsoluteStateAddress, value: readonly unknown[]): void {
  if (pendingBaselines !== null) {
    pendingBaselines.set(address, value);
    return;
  }
  stateListBaselineByAbsoluteStateAddress.set(address, value);
}

/** 更新バッチの開始（updater が最初の enqueue で呼ぶ）。 */
export function beginStateListBaselineBatch(): void {
  batchDepth++;
  if (pendingBaselines === null) {
    pendingBaselines = new Map<IAbsoluteStateAddress, readonly unknown[]>();
  }
}

/** 更新バッチの終了（updater が drain の finally で呼ぶ）。入れ子が全部閉じたら確定する。 */
export function endStateListBaselineBatch(): void {
  if (batchDepth === 0) {
    // enqueue を経ない直接 drain（testApplyChange）。開いていないバッチは閉じない。
    return;
  }
  batchDepth--;
  if (batchDepth > 0 || pendingBaselines === null) {
    return;
  }
  for (const [address, value] of pendingBaselines) {
    stateListBaselineByAbsoluteStateAddress.set(address, value);
  }
  pendingBaselines = null;
}

/** 台帳から 1 件落とす（描画側の clearLastListValueByAbsoluteStateAddress と対にしておく）。 */
export function clearStateListBaseline(address: IAbsoluteStateAddress): void {
  pendingBaselines?.delete(address);
  stateListBaselineByAbsoluteStateAddress.delete(address);
}

export function hasStateListBaseline(address: IAbsoluteStateAddress): boolean {
  return (pendingBaselines?.has(address) ?? false)
    || stateListBaselineByAbsoluteStateAddress.has(address);
}

/**
 * 要素書き込みの入れ替えが揃ったとき、`for` の描画基準に据える「書き込む前の並びの写し」の印（#4）。
 *
 * `for` はこの写しとの差分でだけ、同じ位置で外す行と入る行の Content をその場で使い回す
 * （applyChangeToFor の collectInPlaceContents）。配列の置換の差分は、これまでどおり外した行の
 * Content をプールに通す。
 */
const swapBaselineLists = new WeakSet<object>();

export function markSwapBaselineList(list: readonly unknown[]): void {
  swapBaselineLists.add(list);
}

export function isSwapBaselineList(list: unknown): boolean {
  return swapBaselineLists.has(list as object);
}

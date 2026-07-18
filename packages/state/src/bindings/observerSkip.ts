// framework 自身が detach し明示的に解体（deactivate/unmount）したノード。
// BindingOwner の MutationObserver は削除サブツリー走査でこれらをスキップする。
//
// 根拠: 削除時の handleRemovedNode は binding を dispose するだけ（DOM 構造変更も
// connect-snapshot 依存も無い）で、framework が unmount 経路で既に dispose 済みの
// content に対しては純粋な冗長走査（forEachInclusive で削除サブツリー全体を歩く）に
// なる。create（追加）経路は two-way の connect-time snapshot を observer に依存する
// ため対象外だが、削除は依存が無いため安全に飛ばせる。
//
// マークは observer が削除を配送した時点で消費（削除）する。マーク〜配送の間隔は
// 単一 microtask であり、その間に外部 DOM 変異は割り込めない（framework の drain は
// 同期）ため、マークは framework 由来の削除にしか一致しない。
const observerSkipNodes = new WeakSet<Node>();

export function markObserverSkipOnRemove(node: Node): void {
  observerSkipNodes.add(node);
}

// マーク済みなら true を返しつつマークを消費する。未マークなら false。
export function consumeObserverSkipOnRemove(node: Node): boolean {
  if (!observerSkipNodes.has(node)) {
    return false;
  }
  observerSkipNodes.delete(node);
  return true;
}

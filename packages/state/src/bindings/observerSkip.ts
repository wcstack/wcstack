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

// framework 自身がマウント（Content.appendTo / mountAfter）したノード。
// 追加サブツリー走査の実質の仕事は connect-snapshot 待ち（observationPending）の
// record への配送だけで、record 自体は同期マウント（activateContent → start）で
// observer flush より先に active 済み。よって待ちがグローバルに 1 つも無ければ
// 追加側走査も冗長であり丸ごとスキップできる（削除側スキップの対称形）。
// マーク〜配送が単一 microtask で外部変異が割り込めない前提も削除側と同じ。
const observerSkipAddedNodes = new WeakSet<Node>();

export function markObserverSkipOnAdd(node: Node): void {
  observerSkipAddedNodes.add(node);
}

// マーク済みなら true を返しつつマークを消費する（削除側と同じ one-shot 契約）。
export function consumeObserverSkipOnAdd(node: Node): boolean {
  if (!observerSkipAddedNodes.has(node)) {
    return false;
  }
  observerSkipAddedNodes.delete(node);
  return true;
}

// connect-snapshot 待ち（two-way sync=connect で未接続のまま activate された record）の
// グローバル件数。> 0 の間は追加側スキップを無効化して従来走査に戻す。
// increment は settleInitialRecord、decrement は readProducerSnapshot（消化時）と
// runTeardowns（未消化のまま終端した record のリーク防止）が担う。
let pendingObservationCount = 0;

export function incrementPendingObservation(): void {
  pendingObservationCount++;
}

export function decrementPendingObservation(): void {
  pendingObservationCount--;
}

export function hasPendingObservation(): boolean {
  return pendingObservationCount > 0;
}

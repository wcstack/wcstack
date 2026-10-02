import { bindSubtree, getBinder, type IWcsBindOptions } from "./protocol/binder";

/**
 * binder への宣言: router はルートの範囲（placeholder 〜 終了マーカー）を持ち運ぶ
 * （hideRoute / showRoute）。範囲の中に描かれたもの（直下の構造テンプレートの行・枝）も
 * 一緒に出入りするので、binder はそうしたテンプレートを描いてよい（docs/binder-protocol-design.md §2）。
 */
export const ROUTE_RANGE: IWcsBindOptions = { range: true };

/**
 * 文書に置いたノードの要素を、範囲を持ち運ぶ宣言付きで binder へ渡す（挿入の後に渡す — D5）。
 * binder が居なければ渡さない: 保留キューに溜めず、後から来る state の最初の走査が拾う。
 */
export function offerToBinder(nodes: Iterable<Node>): void {
  if (getBinder() === null) return;
  for (const node of nodes) if (node.nodeType === 1) bindSubtree(node, ROUTE_RANGE);
}

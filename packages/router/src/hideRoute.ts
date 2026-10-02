import { IRoute } from "./components/types";
import { moveInto, rangeOf } from "./routeRange";

/**
 * ルートの内容を `route.held` へ持ち出す: placeholder から `route.endMarker` までの範囲。
 * state が描いた行・枝とアンカーは childNodeArray に無いので、範囲で持つ。範囲の外へ
 * 移された自分のノード（body のダイアログ）は元の順の位置で持ち、親の無いもの
 * （アンカーに置き換えられた template）は戻さない。すでに持っていれば何もしない
 * （重なったナビゲーションが二度隠しても、持っている内容を失わない）。
 */
export function holdRoute(route: IRoute): void {
  if (route.held !== null) {
    return;
  }
  // Decide which nodes go, and in which order, before moving any: a move runs disconnectedCallback.
  const nodes = rangeOf(route);
  const top = new Set<Node>(nodes);
  const outer = [...nodes, ...route.childNodeArray];
  let prev: Node | null = null;
  for (const node of route.childNodeArray) {
    if (top.has(node)) {
      prev = node;
    } else if (node.parentNode !== null && !outer.some((other) => other !== node && other.contains(node))) {
      // an own node moved out of the range goes back where it was written (one inside another goes with it)
      nodes.splice(prev === null ? 0 : nodes.indexOf(prev) + 1, 0, node);
      top.add(node);
      prev = node;
    }
  }
  const held = document.createDocumentFragment();
  moveInto(held, nodes);
  held.appendChild(route.endMarker);
  route.held = held;
}

/** ルートの内容を隠す: パラメータを消し、内容を持ち出す */
export function hideRoute(route: IRoute) {
  route.clearParams();
  holdRoute(route);
}

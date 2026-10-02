import { bindSubtree, getBinder, type IWcsBindOptions } from "./protocol/binder";
import type { IRoute } from "./components/types";

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
  for (const node of nodes) {
    if (node.nodeType === 1) {
      bindSubtree(node, ROUTE_RANGE);
    }
  }
}

/** The placeholders and end marks of a route's descendants */
function innerMarks(route: IRoute, marks: Set<Node>): Set<Node> {
  for (const child of route.routeChildNodes) {
    marks.add(child.placeHolder).add(child.endMarker);
    innerMarks(child, marks);
  }
  return marks;
}

/**
 * The nodes between a route's placeholder and its end mark, in order. When the end mark is not
 * after the placeholder (other code moved or removed it), the range ends at the last of the route's
 * own nodes still beside the placeholder, and never runs past another route's mark (a sibling's
 * placeholder, a parent's end mark): what follows cannot be told from what is not the route's, and
 * an own node beyond goes back as one moved out of the range. Read in full before anything is
 * moved: moving runs disconnectedCallback, which may change what follows the placeholder.
 */
export function rangeOf(route: IRoute): Node[] {
  const placeHolder = route.placeHolder;
  const end = route.endMarker;
  const marked = end.parentNode !== null && end.parentNode === placeHolder.parentNode &&
    (placeHolder.compareDocumentPosition(end) & 4 /* DOCUMENT_POSITION_FOLLOWING */) !== 0;
  const inner = marked ? null : innerMarks(route, new Set());
  const nodes: Node[] = [];
  let length = 0;
  for (let node = placeHolder.nextSibling; node !== null && node !== end; node = node.nextSibling) {
    if (inner !== null && node.nodeType === 8 && /^@@(route:|wcs-route-)/.test((node as Comment).data) && !inner.has(node)) {
      break;
    }
    nodes.push(node);
    if (marked || route.childNodeArray.includes(node)) {
      length = nodes.length;
    }
  }
  nodes.length = length;
  return nodes;
}

/**
 * Moves `nodes` into `target` in order. Each move may run a disconnectedCallback, which may move or
 * remove a node that comes later in the list (a `<wcs-link>` removes its anchor): such a node is
 * left where that callback put it.
 */
export function moveInto(target: Node, nodes: Node[]): void {
  const from = nodes.map((node) => node.parentNode);
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].parentNode === from[i]) {
      target.appendChild(nodes[i]);
    }
  }
}

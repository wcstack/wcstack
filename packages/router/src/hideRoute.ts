import { IRoute } from "./components/types";

/**
 * ルートの内容を隠す: placeholder から `route.endMarker` までの範囲を `route.held` へ移す。
 * state が描いた行・枝とアンカーは childNodeArray に無いので、範囲で持つ。範囲の外へ
 * 移された自分のノード（body のダイアログ）は元の順の位置で持ち、親の無いもの
 * （アンカーに置き換えられた template）は戻さない。
 */
export function hideRoute(route: IRoute) {
  route.clearParams();
  const placeHolder = route.placeHolder;
  const end = route.endMarker;
  const held = document.createDocumentFragment();
  if (end.parentNode !== null && end.parentNode === placeHolder.parentNode &&
      placeHolder.compareDocumentPosition(end) & 4 /* DOCUMENT_POSITION_FOLLOWING */) {
    for (let node = placeHolder.nextSibling!; node !== end; node = placeHolder.nextSibling!) {
      held.appendChild(node);
    }
  }
  let prev: Node | null = null;
  for (const node of route.childNodeArray) {
    if (node.parentNode === held) {
      prev = node;
    } else if (node.parentNode !== null && !held.contains(node)) {
      held.insertBefore(node, prev ? prev.nextSibling : held.firstChild);
      prev = node;
    }
  }
  held.appendChild(end);
  route.held = held;
}

import { inSsr } from "../config";
import { IBindingInfo } from "../binding/types";
import { IApplyContext } from "./types";

const ssrWrappedNodes: WeakSet<Node> = new WeakSet();

export function applyChangeToText(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  // nodeValue は nullable DOMString（実ブラウザでは null / undefined とも空文字に
  // 正規化される）ため、比較前に同じ規則で文字列化する。生値のまま比較すると
  // 数値など非文字列値は常に不一致になり、同値でも毎回 DOM 書き込みが走る。
  // 注: happy-dom は undefined を "undefined" にする非準拠実装なので String() に
  // 頼らず明示的に "" へ正規化する。
  const text = newValue === null || newValue === undefined ? "" : String(newValue);
  if (binding.replaceNode.nodeValue !== text) {
    binding.replaceNode.nodeValue = text;
  }
  // SSR モード時: テキストノードの前後にコメントを挿入して境界を明示
  if (inSsr() && !ssrWrappedNodes.has(binding.replaceNode)) {
    ssrWrappedNodes.add(binding.replaceNode);
    const parentNode = binding.replaceNode.parentNode;
    if (parentNode) {
      const path = binding.statePathName;
      const startComment = document.createComment(`@@wcs-text-start:${path}`);
      const endComment = document.createComment(`@@wcs-text-end:${path}`);
      parentNode.insertBefore(startComment, binding.replaceNode);
      parentNode.insertBefore(endComment, binding.replaceNode.nextSibling);
    }
  }
}

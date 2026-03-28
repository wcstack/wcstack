import { inSsr } from "../config";
import { IBindingInfo } from "../binding/types";
import { IApplyContext } from "./types";

const ssrWrappedNodes: WeakSet<Node> = new WeakSet();

export function applyChangeToText(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  if (binding.replaceNode.nodeValue !== newValue) {
    binding.replaceNode.nodeValue = newValue as string;
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

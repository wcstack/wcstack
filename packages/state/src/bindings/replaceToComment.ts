import { IBindingInfo } from "../types.js";

export function replaceToComment(bindingInfo: IBindingInfo): void {
  const rawNode = bindingInfo.rawNode;
  const targetNode = bindingInfo.node;
  if (rawNode === targetNode) {
    return;
  }
  if (rawNode.parentNode === null) {
    // already replaced
    return;
  }
  rawNode.parentNode.replaceChild(targetNode, rawNode);
}

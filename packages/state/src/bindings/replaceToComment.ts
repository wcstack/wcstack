import { IBindingInfo } from "../types.js";

export function replaceToComment(bindingInfo: IBindingInfo): void {
  const node = bindingInfo.node;
  const placeHolderNode = bindingInfo.placeHolderNode;
  if (node === placeHolderNode) {
    return;
  }
  if (node.parentNode === null) {
    // already replaced
    return;
  }
  node.parentNode.replaceChild(placeHolderNode, node);
}

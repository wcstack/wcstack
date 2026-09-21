import { IBindingInfo } from "../types";
import { IApplyContext } from "./types";

export function applyChangeToAttribute(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  const element = binding.node as Element;
  const attrName = binding.propSegments[1];
  // 値が無い（undefined / null）属性は削除する（要件 B8）。以前は文字列 "undefined" / "null" を書いていた
  if (newValue === undefined || newValue === null) {
    if (element.hasAttribute(attrName)) {
      element.removeAttribute(attrName);
    }
    return;
  }
  if (element.getAttribute(attrName) !== newValue) {
    element.setAttribute(attrName, newValue as string);
  }
}

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
  // 属性の値は常に文字列なので、比較の前に同じ規則で文字列化する（`applyChangeToText` と同じ）。
  // 生値のまま比べると数値・真偽値を束ねた属性は同値でも毎回 setAttribute が走っていた
  const text = String(newValue);
  if (element.getAttribute(attrName) !== text) {
    element.setAttribute(attrName, text);
  }
}

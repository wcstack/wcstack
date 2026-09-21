import { IBindingInfo } from "../types";
import { warnV3Migration } from "../v3Migration";
import { IApplyContext } from "./types";

export function applyChangeToAttribute(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  const element = binding.node as Element;
  const attrName = binding.propSegments[1];
  if (newValue === undefined || newValue === null) {
    // 3.0 は値の無い属性を削除する（要件 B8）— 2.x との差を予告する
    warnV3Migration(`"attr.${attrName}: ${binding.statePathName}" got ${newValue}: 3.0 removes the attribute.`);
  }
  if (element.getAttribute(attrName) !== newValue) {
    element.setAttribute(attrName, newValue as string);
  }
}

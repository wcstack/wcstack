import { IBindingInfo } from "../types";
import { IApplyContext } from "./types";

export function applyChangeToAttribute(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  const element = binding.node as Element;
  const attrName = binding.propSegments[1];
  if (element.getAttribute(attrName) !== newValue) {
    element.setAttribute(attrName, newValue as string);
  }
}

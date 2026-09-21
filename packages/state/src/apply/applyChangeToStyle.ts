import { IBindingInfo } from "../types";
import { IApplyContext } from "./types";

export function applyChangeToStyle(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  const styleName = binding.propSegments[1];
  const style = (binding.node as HTMLElement).style;
  // 値が無い（undefined / null）スタイルは消す（要件 B8）
  if (newValue === undefined || newValue === null) {
    newValue = "";
  }
  const currentValue = (style as any)[styleName];
  if (currentValue !== newValue) {
    (style as any)[styleName] = newValue;
  }
}

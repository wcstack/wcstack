import { IBindingInfo } from "../types";
import { warnV3Migration } from "../v3Migration";
import { IApplyContext } from "./types";

export function applyChangeToStyle(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  const styleName = binding.propSegments[1];
  const style = (binding.node as HTMLElement).style;
  if (newValue === undefined) {
    // 3.0 は値の無いスタイルを消す（要件 B8）— 2.x との差を予告する
    warnV3Migration(`"style.${styleName}: ${binding.statePathName}" got undefined: 3.0 clears it.`);
  }
  const currentValue = (style as any)[styleName];
  if (currentValue !== newValue) {
    (style as any)[styleName] = newValue;
  }
}

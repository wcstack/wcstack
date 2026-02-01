import { IBindingInfo } from "../types.js";
import { applyChangeToElement } from "./applyChangeToElement.js";
import { applyChangeToFor } from "./applyChangeToFor.js";
import { applyChangeToIf } from "./applyChangeToIf.js";
import { applyChangeToText } from "./applyChangeToText.js";

export function applyChange(bindingInfo: IBindingInfo, newValue: any): void {
  let filteredValue = newValue;
  for(const filter of bindingInfo.filters) {
    filteredValue = filter.filterFn(filteredValue);
  }
  if (bindingInfo.bindingType === "text") {
    applyChangeToText(bindingInfo.replaceNode as Text, filteredValue);
  } else if (bindingInfo.bindingType === "prop") {
    applyChangeToElement(bindingInfo.node as HTMLElement, bindingInfo.propSegments, filteredValue);
  } else if (bindingInfo.bindingType === "for") {
    applyChangeToFor(bindingInfo, filteredValue);
  } else if (bindingInfo.bindingType === "if"
     || bindingInfo.bindingType === "else"
     || bindingInfo.bindingType === "elseif"
  ) {
    applyChangeToIf(bindingInfo, filteredValue);
  }
}

import { IBindingInfo } from "../types.js";
import { applyChangeToElement } from "./applyChangeToElement.js";
import { applyChangeToFor } from "./applyChangeToFor.js";
import { applyChangeToText } from "./applyChangeToText.js";

export function applyChange(bindingInfo: IBindingInfo, newValue: any): void {
  let filteredValue = newValue;
  for(const filter of bindingInfo.filters) {
    filteredValue = filter.filterFn(filteredValue);
  }
  if (bindingInfo.bindingType === "text") {
    applyChangeToText(bindingInfo.placeHolderNode as Text, filteredValue);
  } else if (bindingInfo.bindingType === "prop") {
    applyChangeToElement(bindingInfo.node as HTMLElement, bindingInfo.propSegments, filteredValue);
  } else if (bindingInfo.bindingType === "for") {
    if (!bindingInfo.uuid) {
      throw new Error(`BindingInfo for 'for' binding must have a UUID.`);
    }
    applyChangeToFor(bindingInfo.node, bindingInfo.uuid, filteredValue);
  }
}
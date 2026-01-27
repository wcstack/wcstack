import { IBindingInfo } from "../types.js";
import { applyChangeToElement } from "./applyChangeToElement.js";
import { applyChangeToFor } from "./applyChangeToFor.js";
import { applyChangeToText } from "./applyChangeToText.js";

export function applyChange(bindingInfo: IBindingInfo, newValue: any): void {
  if (bindingInfo.bindingType === "text") {
    applyChangeToText(bindingInfo.placeHolderNode as Text, newValue);
  } else if (bindingInfo.bindingType === "prop") {
    applyChangeToElement(bindingInfo.node as HTMLElement, bindingInfo.propSegments, newValue);
  } else if (bindingInfo.bindingType === "for") {
    if (!bindingInfo.uuid) {
      throw new Error(`BindingInfo for 'for' binding must have a UUID.`);
    }
    applyChangeToFor(bindingInfo.node, bindingInfo.uuid, newValue);
  }
}
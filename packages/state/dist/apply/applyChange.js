import { applyChangeToElement } from "./applyChangeToElement.js";
import { applyChangeToFor } from "./applyChangeToFor.js";
import { applyChangeToText } from "./applyChangeToText.js";
export function applyChange(bindingInfo, newValue) {
    if (bindingInfo.bindingType === "text") {
        applyChangeToText(bindingInfo.placeHolderNode, newValue);
    }
    else if (bindingInfo.bindingType === "prop") {
        applyChangeToElement(bindingInfo.node, bindingInfo.propSegments, newValue);
    }
    else if (bindingInfo.bindingType === "for") {
        if (!bindingInfo.uuid) {
            throw new Error(`BindingInfo for 'for' binding must have a UUID.`);
        }
        applyChangeToFor(bindingInfo.node, bindingInfo.uuid, newValue);
    }
}
//# sourceMappingURL=applyChange.js.map
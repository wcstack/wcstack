import { applyChangeToElement } from "./applyChangeToElement.js";
import { applyChangeToFor } from "./applyChangeToFor.js";
import { applyChangeToText } from "./applyChangeToText.js";
export function applyChange(bindingInfo, newValue) {
    let filteredValue = newValue;
    for (const filter of bindingInfo.filters) {
        filteredValue = filter.filterFn(filteredValue);
    }
    if (bindingInfo.bindingType === "text") {
        applyChangeToText(bindingInfo.placeHolderNode, filteredValue);
    }
    else if (bindingInfo.bindingType === "prop") {
        applyChangeToElement(bindingInfo.node, bindingInfo.propSegments, filteredValue);
    }
    else if (bindingInfo.bindingType === "for") {
        if (!bindingInfo.uuid) {
            throw new Error(`BindingInfo for 'for' binding must have a UUID.`);
        }
        applyChangeToFor(bindingInfo.node, bindingInfo.uuid, filteredValue);
    }
}
//# sourceMappingURL=applyChange.js.map
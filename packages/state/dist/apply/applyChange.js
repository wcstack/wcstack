import { applyChangeToElement } from "./applyChangeToElement.js";
import { applyChangeToFor } from "./applyChangeToFor.js";
import { applyChangeToIf } from "./applyChangeToIf.js";
import { applyChangeToText } from "./applyChangeToText.js";
export function applyChange(bindingInfo, newValue) {
    let filteredValue = newValue;
    for (const filter of bindingInfo.filters) {
        filteredValue = filter.filterFn(filteredValue);
    }
    if (bindingInfo.bindingType === "text") {
        applyChangeToText(bindingInfo.replaceNode, filteredValue);
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
    else if (bindingInfo.bindingType === "if"
        || bindingInfo.bindingType === "else"
        || bindingInfo.bindingType === "elseif") {
        if (!bindingInfo.uuid) {
            throw new Error(`BindingInfo for 'if' or 'else' or 'elseif' binding must have a UUID.`);
        }
        applyChangeToIf(bindingInfo.node, bindingInfo.uuid, filteredValue);
    }
}
//# sourceMappingURL=applyChange.js.map
import { raiseError } from "../raiseError.js";
import { getStateElementByName } from "../stateElementByName.js";
import { applyChangeToElement } from "./applyChangeToElement.js";
import { applyChangeToFor } from "./applyChangeToFor.js";
import { applyChangeToIf } from "./applyChangeToIf.js";
import { applyChangeToText } from "./applyChangeToText.js";
import { getFilteredValue } from "./getFilteredValue.js";
import { getValue } from "./getValue.js";
function _applyChange(bindingInfo, state, stateName) {
    const value = getValue(state, bindingInfo);
    const filteredValue = getFilteredValue(value, bindingInfo.filters);
    if (bindingInfo.bindingType === "text") {
        applyChangeToText(bindingInfo.replaceNode, filteredValue);
    }
    else if (bindingInfo.bindingType === "prop") {
        applyChangeToElement(bindingInfo.node, bindingInfo.propSegments, filteredValue);
    }
    else if (bindingInfo.bindingType === "for") {
        applyChangeToFor(bindingInfo, filteredValue, state, stateName);
    }
    else if (bindingInfo.bindingType === "if"
        || bindingInfo.bindingType === "else"
        || bindingInfo.bindingType === "elseif") {
        applyChangeToIf(bindingInfo, filteredValue, state, stateName);
    }
}
export function applyChange(bindingInfo, state, stateName) {
    if (bindingInfo.stateName !== stateName) {
        const stateElement = getStateElementByName(bindingInfo.stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${bindingInfo.stateName}" not found for binding.`);
        }
        stateElement.createState("readonly", (targetState) => {
            _applyChange(bindingInfo, targetState, bindingInfo.stateName);
        });
    }
    else {
        _applyChange(bindingInfo, state, stateName);
    }
}
//# sourceMappingURL=applyChange.js.map
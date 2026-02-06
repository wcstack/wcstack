import { raiseError } from "../raiseError.js";
import { getStateElementByName } from "../stateElementByName.js";
import { applyChangeToAttribute } from "./applyChangeToAttribute.js";
import { applyChangeToClass } from "./applyChangeToClass.js";
import { applyChangeToFor } from "./applyChangeToFor.js";
import { applyChangeToIf } from "./applyChangeToIf.js";
import { applyChangeToProperty } from "./applyChangeToProperty.js";
import { applyChangeToStyle } from "./applyChangeToStyle.js";
import { applyChangeToText } from "./applyChangeToText.js";
import { getFilteredValue } from "./getFilteredValue.js";
import { getValue } from "./getValue.js";
const applyChangeByFirstSegment = {
    "class": applyChangeToClass,
    "attr": applyChangeToAttribute,
    "style": applyChangeToStyle,
};
const applyChangeByBindingType = {
    "text": applyChangeToText,
    "for": applyChangeToFor,
    "if": applyChangeToIf,
    "else": applyChangeToIf,
    "elseif": applyChangeToIf,
};
function _applyChange(binding, context) {
    const value = getValue(context.state, binding);
    const filteredValue = getFilteredValue(value, binding.filters);
    let fn = applyChangeByBindingType[binding.bindingType];
    if (typeof fn === 'undefined') {
        const firstSegment = binding.propSegments[0];
        fn = applyChangeByFirstSegment[firstSegment];
        if (typeof fn === 'undefined') {
            fn = applyChangeToProperty;
        }
    }
    fn(binding, context, filteredValue);
}
export function applyChange(binding, context) {
    if (binding.stateName !== context.stateName) {
        const stateElement = getStateElementByName(binding.stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${binding.stateName}" not found for binding.`);
        }
        stateElement.createState("readonly", (targetState) => {
            const newContext = {
                stateName: binding.stateName,
                stateElement: stateElement,
                state: targetState
            };
            _applyChange(binding, newContext);
        });
    }
    else {
        _applyChange(binding, context);
    }
}
//# sourceMappingURL=applyChange.js.map
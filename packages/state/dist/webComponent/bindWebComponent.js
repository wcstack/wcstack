import { getBindingsByNode } from "../bindings/getBindingsByNode";
import { config } from "../config";
import { WEBCOMPONENT_STATE_READY_CALLBACK_NAME } from "../define";
import { raiseError } from "../raiseError";
import { markWebComponentAsComplete } from "./completeWebComponent";
import { createInnerState } from "./innerState";
import { buildPrimaryMappingRule } from "./MappingRule";
import { meltFrozenObject } from "./meltFrozenObject";
import { createOuterState } from "./outerState";
import { createPlainOuterState } from "./plainOuterState";
import { setStateElementByWebComponent } from "./stateElementByWebComponent";
const getOuter = (outerState) => () => outerState;
export function bindWebComponent(innerStateElement, component, stateProp, state) {
    if (component.shadowRoot === null) {
        raiseError('Component has no shadow root.');
    }
    setStateElementByWebComponent(component, stateProp, innerStateElement);
    if (component.hasAttribute(config.bindAttributeName)) {
        const bindings = (getBindingsByNode(component) ?? []).filter(binding => binding.propSegments[0] === stateProp);
        buildPrimaryMappingRule(component, stateProp, bindings);
        const outerState = createOuterState(component, stateProp);
        const innerState = createInnerState(component, stateProp);
        innerStateElement.setInitialState(innerState);
        Object.defineProperty(component, stateProp, {
            get: getOuter(outerState),
            enumerable: true,
            configurable: true,
        });
    }
    else {
        innerStateElement.setInitialState(meltFrozenObject(state));
        const outerState = createPlainOuterState(component, stateProp);
        Object.defineProperty(component, stateProp, {
            get: getOuter(outerState),
            enumerable: true,
            configurable: true,
        });
    }
    markWebComponentAsComplete(component, innerStateElement);
    if (WEBCOMPONENT_STATE_READY_CALLBACK_NAME in component) {
        const func = component[WEBCOMPONENT_STATE_READY_CALLBACK_NAME];
        if (typeof func === 'function') {
            func.call(component, stateProp).catch((error) => {
                raiseError(`Error in ${WEBCOMPONENT_STATE_READY_CALLBACK_NAME}: ${error instanceof Error ? error.message : String(error)}`);
            });
        }
        else {
            raiseError(`${WEBCOMPONENT_STATE_READY_CALLBACK_NAME} is not a function.`);
        }
    }
}
//# sourceMappingURL=bindWebComponent.js.map
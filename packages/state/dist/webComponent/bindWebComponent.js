import { getBindingsByNode } from "../bindings/getBindingsByNode";
import { config } from "../config";
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
}
//# sourceMappingURL=bindWebComponent.js.map
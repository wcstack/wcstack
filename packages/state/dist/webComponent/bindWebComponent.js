import { getBindingsByNode } from "../bindings/getBindingsByNode";
import { config } from "../config";
import { raiseError } from "../raiseError";
import { createInnerState } from "./innerState";
import { buildPrimaryMappingRule } from "./MappingRule";
import { createOuterState } from "./outerState";
import { setStateElementByWebComponent } from "./stateElementByWebComponent";
const getOuter = (outerState) => () => outerState;
export function bindWebComponent(innerStateElement, component, stateProp) {
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
}
//# sourceMappingURL=bindWebComponent.js.map
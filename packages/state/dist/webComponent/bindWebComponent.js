import { getBindingsByNode } from "../bindings/getBindingsByNode";
import { waitInitializeBinding } from "../bindings/initializeBindingPromiseByNode";
import { initializeBindings } from "../bindings/initializeBindings";
import { config } from "../config";
import { convertMustacheToComments } from "../mustache/convertMustacheToComments";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { collectStructuralFragments } from "../structural/collectStructuralFragments";
import { waitForStateInitialize } from "../waitForStateInitialize";
import { createInnerState } from "./innerState";
import { createOuterState } from "./outerState";
const getOuter = (outerState) => () => outerState;
const innerStateGetter = (inner, innerName) => () => inner[innerName];
const innerStateSetter = (inner, innerName) => (v) => {
    inner[innerName] = v;
};
export async function bindWebComponent(component, innerStateElement) {
    if (component.shadowRoot === null) {
        raiseError('Component has no shadow root.');
    }
    if (!component.hasAttribute(config.bindAttributeName)) {
        raiseError(`Component has no "${config.bindAttributeName}" attribute for state binding.`);
    }
    const shadowRoot = component.shadowRoot;
    await waitForStateInitialize(shadowRoot);
    convertMustacheToComments(shadowRoot);
    collectStructuralFragments(shadowRoot);
    // initializeBindingsの前にinerState,outerStateの紐付けを行う
    await waitInitializeBinding(component);
    const bindings = getBindingsByNode(component);
    if (bindings === null) {
        raiseError('Bindings not found for component node.');
    }
    const outerState = createOuterState();
    const innerState = createInnerState();
    for (const binding of bindings) {
        const innerName = binding.propSegments.slice(1).join('.');
        const outerName = binding.statePathName;
        const outerStateElement = getStateElementByName(binding.stateName);
        if (outerStateElement === null) {
            raiseError(`State element with name "${binding.stateName}" not found for binding.`);
        }
        outerState.$$bindName(innerStateElement, innerName);
        innerState.$$bindName(outerStateElement, innerName, outerName);
        innerStateElement.bindProperty(innerName, {
            get: innerStateGetter(innerState, innerName),
            set: innerStateSetter(innerState, innerName),
            enumerable: true,
            configurable: true,
        });
    }
    Object.defineProperty(component, "outer", {
        get: getOuter(outerState),
        enumerable: true,
        configurable: true,
    });
    initializeBindings(shadowRoot, null);
}
//# sourceMappingURL=bindWebComponent.js.map
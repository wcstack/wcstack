import { getBindingsByNode } from "../bindings/getBindingsByNode";
import { waitInitializeBinding } from "../bindings/initializeBindingPromiseByNode";
import { initializeBindings } from "../bindings/initializeBindings";
import { config } from "../config";
import { convertMustacheToComments } from "../mustache/convertMustacheToComments";
import { raiseError } from "../raiseError";
import { collectStructuralFragments } from "../structural/collectStructuralFragments";
import { waitForStateInitialize } from "../waitForStateInitialize";
import { createInnerState } from "./innerState";
import { buildPrimaryMappingRule } from "./MappingRule";
import { createOuterState } from "./outerState";
import { setStateElementByWebComponent } from "./stateElementByWebComponent";
const getOuter = (outerState) => () => outerState;
export async function bindWebComponent(innerStateElement, component, stateProp) {
    if (component.shadowRoot === null) {
        raiseError('Component has no shadow root.');
    }
    if (!component.hasAttribute(config.bindAttributeName)) {
        raiseError(`Component has no "${config.bindAttributeName}" attribute for state binding.`);
    }
    setStateElementByWebComponent(component, innerStateElement);
    const shadowRoot = component.shadowRoot;
    await waitForStateInitialize(shadowRoot);
    convertMustacheToComments(shadowRoot);
    collectStructuralFragments(shadowRoot, shadowRoot);
    await waitInitializeBinding(component);
    // initializeBindingsの前にinerState,outerStateの紐付けを行う
    const bindings = getBindingsByNode(component);
    if (bindings === null) {
        raiseError('Bindings not found for component node.');
    }
    buildPrimaryMappingRule(component);
    const outerState = createOuterState(component);
    const innerState = createInnerState(component);
    /*
      for(const binding of bindings) {
        const innerStateProp = binding.propSegments[0];
        const innerName = binding.propSegments.slice(1).join('.');
        if (stateProp !== innerStateProp) {
          raiseError(`Binding prop "${innerStateProp}" does not match stateProp "${stateProp}".`);
        }
        innerStateElement.bindProperty(innerName, {
          get: innerStateGetter(innerState, innerName),
          set: innerStateSetter(innerState, innerName),
          enumerable: true,
          configurable: true,
        });
      }
    */
    innerStateElement.setInitialState(innerState);
    Object.defineProperty(component, stateProp, {
        get: getOuter(outerState),
        enumerable: true,
        configurable: true,
    });
    initializeBindings(shadowRoot, null);
}
//# sourceMappingURL=bindWebComponent.js.map
import { getBindingsByNode } from "../bindings/getBindingsByNode";
import { initializeBindings } from "../bindings/initializeBindings";
import { IStateElement } from "../components/types";
import { config } from "../config";
import { raiseError } from "../raiseError";
import { createInnerState } from "./innerState";
import { buildPrimaryMappingRule } from "./MappingRule";
import { createOuterState } from "./outerState";
import { isWebComponentRegistered, registerWebComponent } from "./registerWebComponent";
import { setStateElementByWebComponent } from "./stateElementByWebComponent";
import { IOuterState } from "./types";

const getOuter = (outerState: IOuterState) => (): IOuterState => outerState;

export async function bindWebComponent(
  innerStateElement: IStateElement,
  component: Element,
  stateProp: string
): Promise<void> {
  if (component.shadowRoot === null) {
    raiseError('Component has no shadow root.');
  }
  setStateElementByWebComponent(component, stateProp, innerStateElement);

  if (!isWebComponentRegistered(component)) {
    await registerWebComponent(component);
  }

  if (component.hasAttribute(config.bindAttributeName)) {
    // initializeBindingsの前にinerState,outerStateの紐付けを行う
    const bindings = (getBindingsByNode(component) ?? []).filter(
      binding => binding.propSegments[0] === stateProp
    );
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

  initializeBindings(component.shadowRoot, null);
  
}

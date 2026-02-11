import { getBindingsByNode } from "../bindings/getBindingsByNode";
import { waitInitializeBinding } from "../bindings/initializeBindingPromiseByNode";
import { initializeBindings } from "../bindings/initializeBindings";
import { IStateElement } from "../components/types";
import { config } from "../config";
import { convertMustacheToComments } from "../mustache/convertMustacheToComments";
import { raiseError } from "../raiseError";
import { collectStructuralFragments } from "../structural/collectStructuralFragments";
import { waitForStateInitialize } from "../waitForStateInitialize";
import { createInnerState } from "./innerState";
import { createOuterState } from "./outerState";
import { bindSymbol } from "./symbols";
import { IInnerState, IOuterState } from "./types";

const getOuter = (outerState: IOuterState) => (): IOuterState => outerState;

const innerStateGetter = (inner:IInnerState, innerName:string) => ():any => inner[innerName];
const innerStateSetter = (inner:IInnerState, innerName:string) => (v:any):void => {
  inner[innerName] = v;
}

export async function bindWebComponent(
  innerStateElement: IStateElement,
  component: Element,
  stateProp: string
): Promise<void> {
  if (component.shadowRoot === null) {
    raiseError('Component has no shadow root.');
  }
  if (!component.hasAttribute(config.bindAttributeName)) {
    raiseError(`Component has no "${config.bindAttributeName}" attribute for state binding.`);
  }
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
  const outerState = createOuterState();
  const innerState = createInnerState();
  for(const binding of bindings) {

    outerState[bindSymbol](innerStateElement, binding);
    innerState[bindSymbol](binding);

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
  Object.defineProperty(component, stateProp, {
    get: getOuter(outerState),
    enumerable: true,
    configurable: true,
  });

  initializeBindings(shadowRoot, null);
  
}

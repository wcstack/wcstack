import { IStateElement } from "../components/types";

const stateElementByWebComponent: WeakMap<Element, Map<string, IStateElement>> = new WeakMap();

export function setStateElementByWebComponent(webComponent: Element, stateProp: string, stateElement: IStateElement): void {
  let stateMap = stateElementByWebComponent.get(webComponent);
  if (!stateMap) {
    stateMap = new Map();
    stateElementByWebComponent.set(webComponent, stateMap);
  }
  stateMap.set(stateProp, stateElement);
}

export function getStateElementByWebComponent(webComponent: Element, stateProp: string): IStateElement | null {
  const stateMap = stateElementByWebComponent.get(webComponent);
  if (!stateMap) {
    return null;
  }
  return stateMap.get(stateProp) ?? null;
}

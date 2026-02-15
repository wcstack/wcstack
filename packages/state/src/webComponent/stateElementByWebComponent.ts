import { IStateElement } from "../components/types";

const stateElementByWebComponent: WeakMap<Element, Map<string, IStateElement>> = new WeakMap();

export function setStateElementByWebComponent(webComponent: Element, stateName: string, stateElement: IStateElement): void {
  let stateMap = stateElementByWebComponent.get(webComponent);
  if (!stateMap) {
    stateMap = new Map();
    stateElementByWebComponent.set(webComponent, stateMap);
  }
  stateMap.set(stateName, stateElement);
}

export function getStateElementByWebComponent(webComponent: Element, stateName: string): IStateElement | null {
  const stateMap = stateElementByWebComponent.get(webComponent);
  if (!stateMap) {
    return null;
  }
  return stateMap.get(stateName) ?? null;
}
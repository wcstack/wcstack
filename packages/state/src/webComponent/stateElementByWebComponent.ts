import { IStateElement } from "../components/types";

const stateElementByWebComponent: WeakMap<Element, IStateElement> = new WeakMap();

export function setStateElementByWebComponent(webComponent: Element, stateElement: IStateElement): void {
  stateElementByWebComponent.set(webComponent, stateElement);
}

export function getStateElementByWebComponent(webComponent: Element): IStateElement | null {
  return stateElementByWebComponent.get(webComponent) ?? null;
}
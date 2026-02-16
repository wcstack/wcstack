import { IStateElement } from "../components/types";

const completeByStateElementByWebComponent = new WeakMap<Element, WeakMap<IStateElement, boolean>>();

export function markWebComponentAsComplete(webComponent: Element, stateElement: IStateElement): void {
  let completeByStateElement = completeByStateElementByWebComponent.get(webComponent);
  if (!completeByStateElement) {
    completeByStateElement = new WeakMap<IStateElement, boolean>();
    completeByStateElementByWebComponent.set(webComponent, completeByStateElement);
  }
  completeByStateElement.set(stateElement, true);
}

export function isWebComponentComplete(webComponent: Element, stateElement: IStateElement): boolean {
  const completeByStateElement = completeByStateElementByWebComponent.get(webComponent);
  if (!completeByStateElement) {
    return false;
  }
  return completeByStateElement.get(stateElement) === true;
}

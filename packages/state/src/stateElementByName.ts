import { IStateElement } from "./components/types";

const stateElementByName = new Map<string, IStateElement>();

export function getStateElementByName(name: string): IStateElement | null {
  return stateElementByName.get(name) || null;
}

export function setStateElementByName(name: string, element: IStateElement | null): void {
  if (element === null) {
    stateElementByName.delete(name);
  } else {
    stateElementByName.set(name, element);
  }
}

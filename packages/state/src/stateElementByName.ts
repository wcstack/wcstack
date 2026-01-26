import { State } from "./components/State";
import { IStateElement } from "./components/types";
import { config } from "./config";

const stateElementByName = new Map<string, IStateElement>();

export function getStateElementByName(name: string): IStateElement | null {
  const result = stateElementByName.get(name) || null;
  if (result === null && name === 'default') {
    const state = document.querySelector<State>(`${config.tagNames.state}:not([name])`);
    if (state instanceof State) {
      stateElementByName.set('default', state);
      return state;
    }
  }
  return result;
}

export function setStateElementByName(name: string, element: IStateElement | null): void {
  if (element === null) {
    stateElementByName.delete(name);
  } else {
    stateElementByName.set(name, element);
  }
}

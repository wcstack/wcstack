import { IStateElement } from "./components/types";
import { config } from "./config";
import { raiseError } from "./raiseError";

const stateElementByNameByNode: WeakMap<Node, Map<string, IStateElement>> = new WeakMap();

export function getStateElementByName(rootNode:Node, name: string): IStateElement | null {
  let stateElementByName = stateElementByNameByNode.get(rootNode);
  if (!stateElementByName) {
    return null;
  }
  return stateElementByName.get(name) || null;
}

export function setStateElementByName(rootNode:Node, name: string, element: IStateElement | null): void {

  let stateElementByName = stateElementByNameByNode.get(rootNode);
  if (!stateElementByName) {
    stateElementByName = new Map<string, IStateElement>();
    stateElementByNameByNode.set(rootNode, stateElementByName);
  }
  if (element === null) {
    stateElementByName.delete(name);
    if (config.debug) {
      console.debug(`State element unregistered: name="${name}"`);
    }
  } else {
    if (stateElementByName.has(name)) {
      raiseError(`State element with name "${name}" is already registered.`);
    }
    stateElementByName.set(name, element);
    if (config.debug) {
      console.debug(`State element registered: name="${name}"`, element);
    }
  }
}

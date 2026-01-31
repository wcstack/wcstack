import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IBindingInfo } from "../types";

const handlerByHandlerKey: Map<string, (event: Event) => any> = new Map();
const bindingInfoSetByHandlerKey: Map<string, Set<IBindingInfo>> = new Map();

function getHandlerKey(bindingInfo: IBindingInfo): string {
  return `${bindingInfo.stateName}::${bindingInfo.statePathName}`;
}

const stateEventHandlerFunction = (
  stateName: string,
  handlerName: string
) => (event: Event): any => {
  const stateElement = getStateElementByName(stateName);
  if (stateElement === null) {
    raiseError(`State element with name "${stateName}" not found for event handler.`);
  }
  stateElement.createStateAsync( async (state) => {
    const handler = state[handlerName];
    if (typeof handler !== "function") {
      raiseError(`Handler "${handlerName}" is not a function on state "${stateName}".`);
    }
    return handler.call(state, event);
  });
}

export function attachEventHandler(bindingInfo: IBindingInfo): boolean {
  if (!bindingInfo.propName.startsWith("on")) {
    return false;
  }
  const key = getHandlerKey(bindingInfo);
  let stateEventHandler = handlerByHandlerKey.get(key);
  if (typeof stateEventHandler === "undefined") {
    stateEventHandler = stateEventHandlerFunction(bindingInfo.stateName, bindingInfo.statePathName);
    handlerByHandlerKey.set(key, stateEventHandler);
  }

  const eventName = bindingInfo.propName.slice(2);
  (bindingInfo.node as Element).addEventListener(eventName, stateEventHandler);

  let bindingInfoSet = bindingInfoSetByHandlerKey.get(key);
  if (typeof bindingInfoSet === "undefined") {
    bindingInfoSet = new Set<IBindingInfo>([bindingInfo]);
    bindingInfoSetByHandlerKey.set(key, bindingInfoSet);
  } else {
    bindingInfoSet.add(bindingInfo);
  }
  return true;
}

export function detachEventHandler(bindingInfo: IBindingInfo): boolean {
  if (!bindingInfo.propName.startsWith("on")) {
    return false;
  }
  const key = getHandlerKey(bindingInfo);
  const stateEventHandler = handlerByHandlerKey.get(key);
  if (typeof stateEventHandler === "undefined") {
    return false;
  }
  const eventName = bindingInfo.propName.slice(2);
  (bindingInfo.node as Element).removeEventListener(eventName, stateEventHandler);

  const bindingInfoSet = bindingInfoSetByHandlerKey.get(key);
  if (typeof bindingInfoSet === "undefined") {
    return false;
  }
  bindingInfoSet.delete(bindingInfo);
  if (bindingInfoSet.size === 0) {
    handlerByHandlerKey.delete(key);
    bindingInfoSetByHandlerKey.delete(key);
  }
  return true;
}

export const __private__ = {
  handlerByHandlerKey,
  bindingInfoSetByHandlerKey,
};


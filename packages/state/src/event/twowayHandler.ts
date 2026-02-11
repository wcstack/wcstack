import { isPossibleTwoWay } from "./isPossibleTwoWay";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IBindingInfo, IFilterInfo } from "../types";
import { setLoopContextSymbol } from "../proxy/symbols";

const handlerByHandlerKey: Map<string, (event: Event) => any> = new Map();
const bindingInfoSetByHandlerKey: Map<string, Set<IBindingInfo>> = new Map();

function getHandlerKey(bindingInfo: IBindingInfo, eventName: string): string {
  const filterKey = bindingInfo.inFilters.map(f => f.filterName + '(' + f.args.join(',') + ')').join('|');
  return `${bindingInfo.stateName}::${bindingInfo.propName}::${bindingInfo.statePathName}::${eventName}::${filterKey}`;
}

function getEventName(bindingInfo: IBindingInfo): string {
  const tagName = (bindingInfo.node as Element).tagName.toLowerCase();
  let eventName = (tagName === 'select') ? 'change' : 'input';
  for(const modifier of bindingInfo.propModifiers) {
    if (modifier.startsWith('on')) {
      eventName = modifier.slice(2);
    }
  }
  return eventName;
}

const twowayEventHandlerFunction = (
  stateName: string,
  propName: string,
  statePathName: string,
  inFilters: IFilterInfo[],
) => (event: Event): any => {
  const node = event.target as Element;
  if (typeof node === "undefined") {
    console.warn(`[@wcstack/state] event.target is undefined.`);
    return;
  }
  if (!(propName in node)) {
    console.warn(`[@wcstack/state] Property "${propName}" does not exist on target element.`);
    return;
  }
  const newValue = (node as any)[propName];
  let filteredNewValue = newValue;
  for(const filter of inFilters) {
    filteredNewValue = filter.filterFn(filteredNewValue);
  }

  const rootNode = node.getRootNode() as Node;
  const stateElement = getStateElementByName(rootNode, stateName);
  if (stateElement === null) {
    raiseError(`State element with name "${stateName}" not found for two-way binding.`);
  }

  const loopContext = getLoopContextByNode(node);
  stateElement.createState("writable", (state) => {
    state[setLoopContextSymbol](loopContext, () => {
      state[statePathName] = filteredNewValue;
    });
  });
}

export function attachTwowayEventHandler(bindingInfo: IBindingInfo): boolean {
  if (isPossibleTwoWay(bindingInfo.node, bindingInfo.propName) && bindingInfo.propModifiers.indexOf('ro') === -1) {
    const eventName = getEventName(bindingInfo);
    const key = getHandlerKey(bindingInfo, eventName);
    let twowayEventHandler = handlerByHandlerKey.get(key);
    if (typeof twowayEventHandler === "undefined") {
      twowayEventHandler = twowayEventHandlerFunction(
        bindingInfo.stateName,
        bindingInfo.propName,
        bindingInfo.statePathName,
        bindingInfo.inFilters
      );
      handlerByHandlerKey.set(key, twowayEventHandler);
    }
    (bindingInfo.node as Element).addEventListener(eventName, twowayEventHandler);
    let bindingInfoSet = bindingInfoSetByHandlerKey.get(key);
    if (typeof bindingInfoSet === "undefined") {
      bindingInfoSet = new Set<IBindingInfo>([bindingInfo]);
      bindingInfoSetByHandlerKey.set(key, bindingInfoSet);
    } else {
      bindingInfoSet.add(bindingInfo);
    }
    return true;
  }
  return false;
}

export function detachTwowayEventHandler(bindingInfo: IBindingInfo): boolean {
  if (isPossibleTwoWay(bindingInfo.node, bindingInfo.propName) && bindingInfo.propModifiers.indexOf('ro') === -1) {
    const eventName = getEventName(bindingInfo);
    const key = getHandlerKey(bindingInfo, eventName);
    const twowayEventHandler = handlerByHandlerKey.get(key);
    if (typeof twowayEventHandler === "undefined") {
      return false;
    }
    (bindingInfo.node as Element).removeEventListener(eventName, twowayEventHandler);

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
  return false;
}

export const __private__ = {
  handlerByHandlerKey,
  bindingInfoSetByHandlerKey,
  getHandlerKey,
  getEventName,
  twowayEventHandlerFunction,
};

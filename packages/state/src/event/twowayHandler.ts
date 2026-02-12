import { isPossibleTwoWay } from "./isPossibleTwoWay";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IBindingInfo, IFilterInfo } from "../types";
import { setLoopContextSymbol } from "../proxy/symbols";

const handlerByHandlerKey: Map<string, (event: Event) => any> = new Map();
const bindingSetByHandlerKey: Map<string, Set<IBindingInfo>> = new Map();

function getHandlerKey(binding: IBindingInfo, eventName: string): string {
  const filterKey = binding.inFilters.map(f => f.filterName + '(' + f.args.join(',') + ')').join('|');
  return `${binding.stateName}::${binding.propName}::${binding.statePathName}::${eventName}::${filterKey}`;
}

function getEventName(binding: IBindingInfo): string {
  const tagName = (binding.node as Element).tagName.toLowerCase();
  let eventName = (tagName === 'select') ? 'change' : 'input';
  for(const modifier of binding.propModifiers) {
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
  if (node === null) {
    console.warn(`[@wcstack/state] event.target is null.`);
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

export function attachTwowayEventHandler(binding: IBindingInfo): boolean {
  if (isPossibleTwoWay(binding.node, binding.propName) && binding.propModifiers.indexOf('ro') === -1) {
    const eventName = getEventName(binding);
    const key = getHandlerKey(binding, eventName);
    let twowayEventHandler = handlerByHandlerKey.get(key);
    if (typeof twowayEventHandler === "undefined") {
      twowayEventHandler = twowayEventHandlerFunction(
        binding.stateName,
        binding.propName,
        binding.statePathName,
        binding.inFilters
      );
      handlerByHandlerKey.set(key, twowayEventHandler);
    }
    (binding.node as Element).addEventListener(eventName, twowayEventHandler);
    let bindingSet = bindingSetByHandlerKey.get(key);
    if (typeof bindingSet === "undefined") {
      bindingSet = new Set<IBindingInfo>([binding]);
      bindingSetByHandlerKey.set(key, bindingSet);
    } else {
      bindingSet.add(binding);
    }
    return true;
  }
  return false;
}

export function detachTwowayEventHandler(binding: IBindingInfo): boolean {
  if (isPossibleTwoWay(binding.node, binding.propName) && binding.propModifiers.indexOf('ro') === -1) {
    const eventName = getEventName(binding);
    const key = getHandlerKey(binding, eventName);
    const twowayEventHandler = handlerByHandlerKey.get(key);
    if (typeof twowayEventHandler === "undefined") {
      return false;
    }
    (binding.node as Element).removeEventListener(eventName, twowayEventHandler);

    const bindingSet = bindingSetByHandlerKey.get(key);
    if (typeof bindingSet === "undefined") {
      return false;
    }
    bindingSet.delete(binding);
    if (bindingSet.size === 0) {
      handlerByHandlerKey.delete(key);
      bindingSetByHandlerKey.delete(key);
    }
    return true;
  }
  return false;
}

export const __private__ = {
  handlerByHandlerKey,
  bindingSetByHandlerKey,
  getHandlerKey,
  getEventName,
  twowayEventHandlerFunction,
};

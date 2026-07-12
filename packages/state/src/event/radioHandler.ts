import { getLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IBindingInfo, IFilterInfo } from "../types";
import { setLoopContextSymbol } from "../proxy/symbols";
import { createHandlerBindingRegistry } from "./handlerBindingRegistry";

const handlerByHandlerKey: Map<string, (event: Event) => any> = new Map();
// binding を強参照しない台帳（handlerBindingRegistry.ts のリーク解説を参照）
const bindingRegistry = createHandlerBindingRegistry();

function getHandlerKey(binding: IBindingInfo, eventName: string): string {
  const filterKey = binding.inFilters.map(f => f.filterName + '(' + f.args.join(',') + ')').join('|');
  return `${binding.stateName}::${binding.statePathName}::${eventName}::${filterKey}`;
}

function getEventName(binding: IBindingInfo): string {
  let eventName = 'input';
  for(const modifier of binding.propModifiers) {
    if (modifier.startsWith('on')) {
      eventName = modifier.slice(2);
    }
  }
  return eventName;
}

const radioEventHandlerFunction = (
  stateName: string,
  statePathName: string,
  inFilters: IFilterInfo[],
) => (event: Event): any => {
  const node = event.target as HTMLInputElement;
  if (node === null) {
    console.warn(`[@wcstack/state] event.target is null.`);
    return;
  }
  if (node.type !== 'radio') {
    console.warn(`[@wcstack/state] event.target is not a radio input element.`);
    return;
  }
  if (node.checked === false) {
    return;
  }
  const newValue = node.value;
  let filteredNewValue: unknown = newValue;
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

export function attachRadioEventHandler(binding: IBindingInfo): boolean {
  if (binding.bindingType === "radio" && binding.propModifiers.indexOf('ro') === -1) {
    const eventName = getEventName(binding);
    const key = getHandlerKey(binding, eventName);
    let radioEventHandler = handlerByHandlerKey.get(key);
    if (typeof radioEventHandler === "undefined") {
      radioEventHandler = radioEventHandlerFunction(
        binding.stateName,
        binding.statePathName,
        binding.inFilters
      );
      handlerByHandlerKey.set(key, radioEventHandler);
    }
    (binding.node as Element).addEventListener(eventName, radioEventHandler);
    bindingRegistry.add(key, binding);
    return true;
  }
  return false;
}

export function detachRadioEventHandler(binding: IBindingInfo): boolean {
  if (binding.bindingType === "radio" && binding.propModifiers.indexOf('ro') === -1) {
    const eventName = getEventName(binding);
    const key = getHandlerKey(binding, eventName);
    const radioEventHandler = handlerByHandlerKey.get(key);
    if (typeof radioEventHandler === "undefined") {
      return false;
    }
    (binding.node as Element).removeEventListener(eventName, radioEventHandler);

    if (bindingRegistry.countOf(key) === 0) {
      return false;
    }
    if (bindingRegistry.remove(key, binding)) {
      handlerByHandlerKey.delete(key);
    }
    return true;
  }
  return false;
}

export const __private__ = {
  handlerByHandlerKey,
  bindingRegistry,
  getHandlerKey,
  getEventName,
  radioEventHandlerFunction,
};

import { isPossibleTwoWay } from "./isPossibleTwoWay";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IBindingInfo, IFilterInfo } from "../types";
import { setLoopContextSymbol } from "../proxy/symbols";
import { getCustomElement } from "../getCustomElement";
import { IWcBindable } from "./types";
import { createHandlerBindingRegistry } from "./handlerBindingRegistry";

const handlerByHandlerKey: Map<string, (event: Event) => any> = new Map();
// binding を強参照しない台帳（handlerBindingRegistry.ts のリーク解説を参照）
const bindingRegistry = createHandlerBindingRegistry();

const DEFAULT_GETTER = (e: Event) => (e as CustomEvent).detail;

function getHandlerKey(binding: IBindingInfo, eventName: string, hasGetter: boolean): string {
  const filterKey = binding.inFilters.map(f => f.filterName + '(' + f.args.join(',') + ')').join('|');
  return `${binding.stateName}::${binding.propName}::${binding.statePathName}::${eventName}::${filterKey}::${hasGetter ? 'g' : 'n'}`;
}

function getEventName(binding: IBindingInfo): string {
  const tagName = (binding.node as Element).tagName.toLowerCase();
  // 1.default event name
  let eventName = (tagName === 'select') ? 'change' : 'input';
  // 2.wcBindable protocol
  const customTagName = getCustomElement(binding.node as Element);
  if (customTagName !== null) {
    const customClass = customElements.get(customTagName) as any;
    if (typeof customClass === "undefined") {
      raiseError(`Custom element <${customTagName}> is not defined. Cannot determine event name for two-way binding.`);
    }
    const bindable: IWcBindable | undefined = customClass.wcBindable;
    if (bindable?.protocol === "wc-bindable" && bindable?.version === 1) {
      const propDesc = bindable.properties.find(p => p.name === binding.propName);
      if (propDesc) {
        eventName = propDesc.event;
      }
    }
  }
  // 3.modifier
  for(const modifier of binding.propModifiers) {
    if (modifier.startsWith('on')) {
      eventName = modifier.slice(2);
    }
  }
  return eventName;
}

function getValueGetter(binding: IBindingInfo): ((event: Event) => any) | null {
  const customTagName = getCustomElement(binding.node as Element);
  if (customTagName !== null) {
    const customClass = customElements.get(customTagName) as any;
    if (customClass) {
      const bindable: IWcBindable | undefined = customClass.wcBindable;
      if (bindable?.protocol === "wc-bindable" && bindable?.version === 1) {
        const propDesc = bindable.properties.find(p => p.name === binding.propName);
        if (propDesc) {
          return propDesc.getter ?? DEFAULT_GETTER;
        }
      }
    }
  }
  return null;
}

const twowayEventHandlerFunction = (
  stateName: string,
  propName: string,
  statePathName: string,
  inFilters: IFilterInfo[],
  valueGetter: ((event: Event) => any) | null,
) => (event: Event): any => {
  const node = event.target as Element;
  if (node === null) {
    console.warn(`[@wcstack/state] event.target is null.`);
    return;
  }
  let newValue: any;
  if (valueGetter !== null) {
    newValue = valueGetter(event);
  } else {
    if (!(propName in node)) {
      console.warn(`[@wcstack/state] Property "${propName}" does not exist on target element.`);
      return;
    }
    newValue = (node as any)[propName];
  }
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

export function attachTwowayEventHandler(binding: IBindingInfo): void {
  const customTagName = getCustomElement(binding.node as Element);
  if (customTagName !== null) {
    const customClass = customElements.get(customTagName);
    if (typeof customClass === "undefined") {
      customElements.whenDefined(customTagName).then(() => {
        attachTwowayEventHandler(binding);
      });
      return;
    }
  }

  if (isPossibleTwoWay(binding.node, binding.propName) && binding.propModifiers.indexOf('ro') === -1) {
    const eventName = getEventName(binding);
    const valueGetter = getValueGetter(binding);
    const key = getHandlerKey(binding, eventName, valueGetter !== null);
    let twowayEventHandler = handlerByHandlerKey.get(key);
    if (typeof twowayEventHandler === "undefined") {
      twowayEventHandler = twowayEventHandlerFunction(
        binding.stateName,
        binding.propName,
        binding.statePathName,
        binding.inFilters,
        valueGetter
      );
      handlerByHandlerKey.set(key, twowayEventHandler);
    }
    (binding.node as Element).addEventListener(eventName, twowayEventHandler);
    bindingRegistry.add(key, binding);
  }
}

export function detachTwowayEventHandler(binding: IBindingInfo): void {
  const customTagName = getCustomElement(binding.node as Element);
  if (customTagName !== null) {
    const customClass = customElements.get(customTagName);
    if (typeof customClass === "undefined") {
      customElements.whenDefined(customTagName).then(() => {
        detachTwowayEventHandler(binding);
      });
      return;
    }
  }

  if (isPossibleTwoWay(binding.node, binding.propName) && binding.propModifiers.indexOf('ro') === -1) {
    const eventName = getEventName(binding);
    const valueGetter = getValueGetter(binding);
    const key = getHandlerKey(binding, eventName, valueGetter !== null);
    const twowayEventHandler = handlerByHandlerKey.get(key);
    if (typeof twowayEventHandler === "undefined") {
      return;
    }
    (binding.node as Element).removeEventListener(eventName, twowayEventHandler);

    if (bindingRegistry.remove(key, binding)) {
      handlerByHandlerKey.delete(key);
    }
  }
}

export const __private__ = {
  handlerByHandlerKey,
  bindingRegistry,
  getHandlerKey,
  getEventName,
  getValueGetter,
  twowayEventHandlerFunction,
  DEFAULT_GETTER,
};

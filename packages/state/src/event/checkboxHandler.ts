import { getLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IBindingInfo, IFilterInfo } from "../types";
import { setLoopContextSymbol } from "../proxy/symbols";

const handlerByHandlerKey: Map<string, (event: Event) => any> = new Map();
const bindingSetByHandlerKey: Map<string, Set<IBindingInfo>> = new Map();

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

const checkboxEventHandlerFunction = (
  stateName: string,
  statePathName: string,
  inFilters: IFilterInfo[],
) => (event: Event): any => {
  const node = event.target as HTMLInputElement;
  if (node === null) {
    console.warn(`[@wcstack/state] event.target is null.`);
    return;
  }
  if (node.type !== 'checkbox') {
    console.warn(`[@wcstack/state] event.target is not a checkbox input element.`);
    return;
  }
  const checked = node.checked;
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
      let currentValue = state[statePathName];
      if (Array.isArray(currentValue)) {
        if (checked) {
          if (currentValue.indexOf(filteredNewValue) === -1) {
            state[statePathName] = currentValue.concat(filteredNewValue);
          }
        } else {
          const index = currentValue.indexOf(filteredNewValue);
          if (index !== -1) {
            state[statePathName] = currentValue.toSpliced(index, 1);
          }
        }
      } else {
        if (checked) {
          state[statePathName] = [filteredNewValue];
        } else {
          state[statePathName] = [];
        }
      }
    });
  });
}

export function attachCheckboxEventHandler(binding: IBindingInfo): boolean {
  if (binding.bindingType === "checkbox" && binding.propModifiers.indexOf('ro') === -1) {
    const eventName = getEventName(binding);
    const key = getHandlerKey(binding, eventName);
    let checkboxEventHandler = handlerByHandlerKey.get(key);
    if (typeof checkboxEventHandler === "undefined") {
      checkboxEventHandler = checkboxEventHandlerFunction(
        binding.stateName,
        binding.statePathName,
        binding.inFilters
      );
      handlerByHandlerKey.set(key, checkboxEventHandler);
    }
    (binding.node as Element).addEventListener(eventName, checkboxEventHandler);
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

export function detachCheckboxEventHandler(binding: IBindingInfo): boolean {
  if (binding.bindingType === "checkbox" && binding.propModifiers.indexOf('ro') === -1) {
    const eventName = getEventName(binding);
    const key = getHandlerKey(binding, eventName);
    const checkboxEventHandler = handlerByHandlerKey.get(key);
    if (typeof checkboxEventHandler === "undefined") {
      return false;
    }
    (binding.node as Element).removeEventListener(eventName, checkboxEventHandler);

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
  checkboxEventHandlerFunction,
};

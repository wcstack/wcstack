import { getLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { setLoopContextSymbol } from "../proxy/symbols";
const handlerByHandlerKey = new Map();
const bindingSetByHandlerKey = new Map();
function getHandlerKey(binding, eventName) {
    const filterKey = binding.inFilters.map(f => f.filterName + '(' + f.args.join(',') + ')').join('|');
    return `${binding.stateName}::${binding.statePathName}::${eventName}::${filterKey}`;
}
function getEventName(binding) {
    let eventName = 'input';
    for (const modifier of binding.propModifiers) {
        if (modifier.startsWith('on')) {
            eventName = modifier.slice(2);
        }
    }
    return eventName;
}
const radioEventHandlerFunction = (stateName, statePathName, inFilters) => (event) => {
    const node = event.target;
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
    let filteredNewValue = newValue;
    for (const filter of inFilters) {
        filteredNewValue = filter.filterFn(filteredNewValue);
    }
    const rootNode = node.getRootNode();
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
};
export function attachRadioEventHandler(binding) {
    if (binding.bindingType === "radio" && binding.propModifiers.indexOf('ro') === -1) {
        const eventName = getEventName(binding);
        const key = getHandlerKey(binding, eventName);
        let radioEventHandler = handlerByHandlerKey.get(key);
        if (typeof radioEventHandler === "undefined") {
            radioEventHandler = radioEventHandlerFunction(binding.stateName, binding.statePathName, binding.inFilters);
            handlerByHandlerKey.set(key, radioEventHandler);
        }
        binding.node.addEventListener(eventName, radioEventHandler);
        let bindingSet = bindingSetByHandlerKey.get(key);
        if (typeof bindingSet === "undefined") {
            bindingSet = new Set([binding]);
            bindingSetByHandlerKey.set(key, bindingSet);
        }
        else {
            bindingSet.add(binding);
        }
        return true;
    }
    return false;
}
export function detachRadioEventHandler(binding) {
    if (binding.bindingType === "radio" && binding.propModifiers.indexOf('ro') === -1) {
        const eventName = getEventName(binding);
        const key = getHandlerKey(binding, eventName);
        const radioEventHandler = handlerByHandlerKey.get(key);
        if (typeof radioEventHandler === "undefined") {
            return false;
        }
        binding.node.removeEventListener(eventName, radioEventHandler);
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
    radioEventHandlerFunction,
};
//# sourceMappingURL=radioHandler.js.map
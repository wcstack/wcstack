import { getLoopContextByNode } from "../list/loopContextByNode";
import { setLoopContextSymbol } from "../proxy/symbols";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
const handlerByHandlerKey = new Map();
const bindingSetByHandlerKey = new Map();
function getHandlerKey(binding) {
    const modifierKey = binding.propModifiers.filter(m => m === 'prevent' || m === 'stop').sort().join(',');
    return `${binding.stateName}::${binding.statePathName}::${modifierKey}`;
}
const stateEventHandlerFunction = (stateName, handlerName, modifiers) => (event) => {
    if (modifiers.includes('prevent'))
        event.preventDefault();
    if (modifiers.includes('stop'))
        event.stopPropagation();
    const node = event.target;
    const rootNode = node.getRootNode();
    const stateElement = getStateElementByName(rootNode, stateName);
    if (stateElement === null) {
        raiseError(`State element with name "${stateName}" not found for event handler.`);
    }
    const loopContext = getLoopContextByNode(node);
    stateElement.createStateAsync("writable", async (state) => {
        state[setLoopContextSymbol](loopContext, () => {
            const handler = state[handlerName];
            if (typeof handler !== "function") {
                raiseError(`Handler "${handlerName}" is not a function on state "${stateName}".`);
            }
            return Reflect.apply(handler, state, [event, ...(loopContext?.listIndex.indexes ?? [])]);
        });
    });
};
export function attachEventHandler(binding) {
    if (!binding.propName.startsWith("on")) {
        return false;
    }
    const key = getHandlerKey(binding);
    let stateEventHandler = handlerByHandlerKey.get(key);
    if (typeof stateEventHandler === "undefined") {
        stateEventHandler = stateEventHandlerFunction(binding.stateName, binding.statePathName, binding.propModifiers);
        handlerByHandlerKey.set(key, stateEventHandler);
    }
    const eventName = binding.propName.slice(2);
    binding.node.addEventListener(eventName, stateEventHandler);
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
export function detachEventHandler(binding) {
    if (!binding.propName.startsWith("on")) {
        return false;
    }
    const key = getHandlerKey(binding);
    const stateEventHandler = handlerByHandlerKey.get(key);
    if (typeof stateEventHandler === "undefined") {
        return false;
    }
    const eventName = binding.propName.slice(2);
    binding.node.removeEventListener(eventName, stateEventHandler);
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
export const __private__ = {
    handlerByHandlerKey,
    bindingSetByHandlerKey,
};
//# sourceMappingURL=handler.js.map
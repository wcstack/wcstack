import { getLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
const handlerByHandlerKey = new Map();
const bindingInfoSetByHandlerKey = new Map();
function getHandlerKey(bindingInfo) {
    return `${bindingInfo.stateName}::${bindingInfo.statePathName}`;
}
const stateEventHandlerFunction = (stateName, handlerName) => (event) => {
    const node = event.target;
    const stateElement = getStateElementByName(stateName);
    if (stateElement === null) {
        raiseError(`State element with name "${stateName}" not found for event handler.`);
    }
    const loopContext = getLoopContextByNode(node);
    stateElement.createStateAsync("writable", async (state) => {
        state.$$setLoopContext(loopContext, () => {
            const handler = state[handlerName];
            if (typeof handler !== "function") {
                raiseError(`Handler "${handlerName}" is not a function on state "${stateName}".`);
            }
            return handler.call(state, event, ...(loopContext?.listIndex.indexes ?? []));
        });
    });
};
export function attachEventHandler(bindingInfo) {
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
    bindingInfo.node.addEventListener(eventName, stateEventHandler);
    let bindingInfoSet = bindingInfoSetByHandlerKey.get(key);
    if (typeof bindingInfoSet === "undefined") {
        bindingInfoSet = new Set([bindingInfo]);
        bindingInfoSetByHandlerKey.set(key, bindingInfoSet);
    }
    else {
        bindingInfoSet.add(bindingInfo);
    }
    return true;
}
export function detachEventHandler(bindingInfo) {
    if (!bindingInfo.propName.startsWith("on")) {
        return false;
    }
    const key = getHandlerKey(bindingInfo);
    const stateEventHandler = handlerByHandlerKey.get(key);
    if (typeof stateEventHandler === "undefined") {
        return false;
    }
    const eventName = bindingInfo.propName.slice(2);
    bindingInfo.node.removeEventListener(eventName, stateEventHandler);
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
//# sourceMappingURL=handler.js.map
import { isPossibleTwoWay } from "./isPossibleTwoWay";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { setLoopContextSymbol } from "../proxy/symbols";
const handlerByHandlerKey = new Map();
const bindingInfoSetByHandlerKey = new Map();
function getHandlerKey(bindingInfo, eventName) {
    const filterKey = bindingInfo.inFilters.map(f => f.filterName + '(' + f.args.join(',') + ')').join('|');
    return `${bindingInfo.stateName}::${bindingInfo.propName}::${bindingInfo.statePathName}::${eventName}::${filterKey}`;
}
function getEventName(bindingInfo) {
    const tagName = bindingInfo.node.tagName.toLowerCase();
    let eventName = (tagName === 'select') ? 'change' : 'input';
    for (const modifier of bindingInfo.propModifiers) {
        if (modifier.startsWith('on')) {
            eventName = modifier.slice(2);
        }
    }
    return eventName;
}
const twowayEventHandlerFunction = (stateName, propName, statePathName, inFilters) => (event) => {
    const node = event.target;
    if (typeof node === "undefined") {
        console.warn(`[@wcstack/state] event.target is undefined.`);
        return;
    }
    if (!(propName in node)) {
        console.warn(`[@wcstack/state] Property "${propName}" does not exist on target element.`);
        return;
    }
    const newValue = node[propName];
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
export function attachTwowayEventHandler(bindingInfo) {
    if (isPossibleTwoWay(bindingInfo.node, bindingInfo.propName) && bindingInfo.propModifiers.indexOf('ro') === -1) {
        const eventName = getEventName(bindingInfo);
        const key = getHandlerKey(bindingInfo, eventName);
        let twowayEventHandler = handlerByHandlerKey.get(key);
        if (typeof twowayEventHandler === "undefined") {
            twowayEventHandler = twowayEventHandlerFunction(bindingInfo.stateName, bindingInfo.propName, bindingInfo.statePathName, bindingInfo.inFilters);
            handlerByHandlerKey.set(key, twowayEventHandler);
        }
        bindingInfo.node.addEventListener(eventName, twowayEventHandler);
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
    return false;
}
export function detachTwowayEventHandler(bindingInfo) {
    if (isPossibleTwoWay(bindingInfo.node, bindingInfo.propName) && bindingInfo.propModifiers.indexOf('ro') === -1) {
        const eventName = getEventName(bindingInfo);
        const key = getHandlerKey(bindingInfo, eventName);
        const twowayEventHandler = handlerByHandlerKey.get(key);
        if (typeof twowayEventHandler === "undefined") {
            return false;
        }
        bindingInfo.node.removeEventListener(eventName, twowayEventHandler);
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
//# sourceMappingURL=twowayHandler.js.map
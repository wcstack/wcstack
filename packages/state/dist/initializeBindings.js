import { applyChangeToNode } from "./applyChangeToNode";
import { getBindingInfos } from "./getBindingInfos";
import { getSubscriberNodes } from "./getSubscriberNodes";
import { isPossibleTwoWay } from "./isPossibleTwoWay";
import { setListIndexByNode } from "./list/listIndexByNode";
import { getStateElementByName } from "./stateElementByName";
const registeredNodeSet = new WeakSet();
export async function initializeBindings(root, parentListIndex) {
    const subscriberNodes = getSubscriberNodes(root);
    const allBindings = [];
    subscriberNodes.forEach(node => {
        if (!registeredNodeSet.has(node)) {
            registeredNodeSet.add(node);
            setListIndexByNode(node, parentListIndex);
            const bindings = getBindingInfos(node);
            allBindings.push(...bindings);
        }
    });
    const applyInfoList = [];
    const cacheValueByPathByStateElement = new Map();
    for (const bindingInfo of allBindings) {
        const stateElement = getStateElementByName(bindingInfo.stateName);
        if (stateElement === null) {
            console.warn(`[@wcstack/state] State element with name "${bindingInfo.stateName}" not found for event binding.`);
            return;
        }
        // event
        if (bindingInfo.propName.startsWith("on")) {
            const eventName = bindingInfo.propName.slice(2);
            bindingInfo.node.addEventListener(eventName, (event) => {
                const handler = stateElement.state[bindingInfo.statePathName];
                if (typeof handler === "function") {
                    handler.call(stateElement.state, event);
                }
            });
            continue;
        }
        // two-way binding
        if (isPossibleTwoWay(bindingInfo.node, bindingInfo.propName) && bindingInfo.propModifiers.indexOf('ro') === -1) {
            const tagName = bindingInfo.node.tagName.toLowerCase();
            let eventName = (tagName === 'select') ? 'change' : 'input';
            for (const modifier of bindingInfo.propModifiers) {
                if (modifier.startsWith('on')) {
                    eventName = modifier.slice(2);
                }
            }
            bindingInfo.node.addEventListener(eventName, (event) => {
                const target = event.target;
                if (typeof target === "undefined") {
                    console.warn(`[@wcstack/state] event.target is undefined.`);
                    return;
                }
                if (!(bindingInfo.propName in target)) {
                    console.warn(`[@wcstack/state] Property "${bindingInfo.propName}" does not exist on target element.`);
                    return;
                }
                const newValue = target[bindingInfo.propName];
                stateElement.state[bindingInfo.statePathName] = newValue;
            });
        }
        // register binding
        stateElement.addBindingInfo(bindingInfo);
        // get cache value
        let cacheValueByPath = cacheValueByPathByStateElement.get(stateElement);
        if (typeof cacheValueByPath === "undefined") {
            cacheValueByPath = new Map();
            cacheValueByPathByStateElement.set(stateElement, cacheValueByPath);
        }
        const cacheValue = cacheValueByPath.get(bindingInfo.statePathName);
        if (typeof cacheValue !== "undefined") {
            // apply cached value
            applyInfoList.push({ bindingInfo, value: cacheValue });
            continue;
        }
        // apply initial value
        await stateElement.initializePromise;
        const value = stateElement.state[bindingInfo.statePathName];
        applyInfoList.push({ bindingInfo, value });
        // set cache value
        cacheValueByPath.set(bindingInfo.statePathName, value);
    }
    // apply all at once
    for (const applyInfo of applyInfoList) {
        applyChangeToNode(applyInfo.bindingInfo.node, applyInfo.bindingInfo.propSegments, applyInfo.value);
    }
}
//# sourceMappingURL=initializeBindings.js.map
import { getStateElementByName } from "../stateElementByName";
import { raiseError } from "../raiseError";
import { replaceToComment } from "./replaceToComment";
import { applyChange } from "../apply/applyChange";
import { collectNodesAndBindingInfos, collectNodesAndBindingInfosByFragment } from "./collectNodesAndBindingInfos";
import { attachEventHandler } from "../event/handler";
import { attachTwowayEventHandler } from "../event/twowayHandler";
import { getListIndexByNode, setListIndexByNode } from "../list/listIndexByNode";
async function _initializeBindings(allBindings) {
    const applyInfoList = [];
    const cacheValueByPathByStateElement = new Map();
    for (const bindingInfo of allBindings) {
        const stateElement = getStateElementByName(bindingInfo.stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${bindingInfo.stateName}" not found for binding.`);
        }
        // replace to comment node
        replaceToComment(bindingInfo);
        // event
        if (attachEventHandler(bindingInfo)) {
            continue;
        }
        // two-way binding
        attachTwowayEventHandler(bindingInfo);
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
        const listIndex = getListIndexByNode(bindingInfo.node);
        const state = stateElement.state;
        const value = state.$stack(listIndex, () => {
            return state[bindingInfo.statePathName];
        });
        applyInfoList.push({ bindingInfo, value });
        // set cache value
        cacheValueByPath.set(bindingInfo.statePathName, value);
    }
    // apply all at once
    for (const applyInfo of applyInfoList) {
        applyChange(applyInfo.bindingInfo, applyInfo.value);
    }
}
export async function initializeBindings(root, parentListIndex) {
    const [subscriberNodes, allBindings] = collectNodesAndBindingInfos(root);
    for (const node of subscriberNodes) {
        if (parentListIndex !== null) {
            setListIndexByNode(node, parentListIndex);
        }
    }
    await _initializeBindings(allBindings);
}
export async function initializeBindingsByFragment(root, nodeInfos, parentListIndex) {
    const [subscriberNodes, allBindings] = collectNodesAndBindingInfosByFragment(root, nodeInfos);
    for (const node of subscriberNodes) {
        if (parentListIndex !== null) {
            setListIndexByNode(node, parentListIndex);
        }
    }
    await _initializeBindings(allBindings);
}
//# sourceMappingURL=initializeBindings.js.map
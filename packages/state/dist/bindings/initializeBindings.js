import { getStateElementByName } from "../stateElementByName";
import { raiseError } from "../raiseError";
import { replaceToComment } from "./replaceToComment";
import { applyChange } from "../apply/applyChange";
import { collectNodesAndBindingInfos, collectNodesAndBindingInfosByFragment } from "./collectNodesAndBindingInfos";
import { attachEventHandler } from "../event/handler";
import { attachTwowayEventHandler } from "../event/twowayHandler";
import { getLoopContextByNode, setLoopContextByNode } from "../list/loopContextByNode";
async function _initializeBindings(allBindings) {
    const applyInfoList = [];
    const bindingsByStateElement = new Map();
    for (const bindingInfo of allBindings) {
        const stateElement = getStateElementByName(bindingInfo.stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${bindingInfo.stateName}" not found for binding.`);
        }
        await stateElement.initializePromise;
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
        // group by state element
        let bindings = bindingsByStateElement.get(stateElement);
        if (typeof bindings === "undefined") {
            bindingsByStateElement.set(stateElement, [bindingInfo]);
        }
        else {
            bindings.push(bindingInfo);
        }
    }
    // get apply values from cache and state
    for (const [stateElement, bindings] of bindingsByStateElement.entries()) {
        const cacheValueByPath = new Map();
        await stateElement.createState(async (state) => {
            for (const bindingInfo of bindings) {
                let cacheValue = cacheValueByPath.get(bindingInfo.statePathName);
                if (typeof cacheValue === "undefined") {
                    const loopContext = getLoopContextByNode(bindingInfo.node);
                    cacheValue = await state.$$setLoopContext(loopContext, () => {
                        return state[bindingInfo.statePathName];
                    });
                    cacheValueByPath.set(bindingInfo.statePathName, cacheValue);
                }
                applyInfoList.push({ bindingInfo, value: cacheValue });
            }
        });
    }
    // apply all at once
    for (const applyInfo of applyInfoList) {
        applyChange(applyInfo.bindingInfo, applyInfo.value);
    }
}
export async function initializeBindings(root, parentLoopContext) {
    const [subscriberNodes, allBindings] = collectNodesAndBindingInfos(root);
    for (const node of subscriberNodes) {
        setLoopContextByNode(node, parentLoopContext);
    }
    await _initializeBindings(allBindings);
}
export async function initializeBindingsByFragment(root, nodeInfos, parentLoopContext) {
    const [subscriberNodes, allBindings] = collectNodesAndBindingInfosByFragment(root, nodeInfos);
    for (const node of subscriberNodes) {
        setLoopContextByNode(node, parentLoopContext);
    }
    await _initializeBindings(allBindings);
}
//# sourceMappingURL=initializeBindings.js.map
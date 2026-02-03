import { getBindingsByContent } from "../bindings/bindingsByContent";
import { config } from "../config";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { getContentByNode } from "../structural/contentByNode";
import { createContent } from "../structural/createContent";
import { applyChange } from "./applyChange";
const lastValueByNode = new WeakMap();
const lastConnectedByNode = new WeakMap();
function bindingInfoText(bindingInfo) {
    return `${bindingInfo.bindingType} ${bindingInfo.statePathName} ${bindingInfo.filters.map(f => f.filterName).join('|')} ${bindingInfo.node.isConnected ? '(connected)' : '(disconnected)'}`;
}
export function applyChangeToIf(bindingInfo, _newValue, state, stateName) {
    const lastConnected = lastConnectedByNode.get(bindingInfo.node) ?? false;
    const currentConnected = bindingInfo.node.isConnected;
    const oldValue = lastValueByNode.get(bindingInfo.node) ?? false;
    const newValue = Boolean(_newValue);
    let content = getContentByNode(bindingInfo.node);
    let initialized = false;
    if (content === null) {
        const loopContext = getLoopContextByNode(bindingInfo.node);
        content = createContent(bindingInfo, loopContext);
        initialized = true;
    }
    try {
        if (oldValue === newValue && lastConnected === currentConnected) {
            if (config.debug) {
                console.log(`if content unchanged (same connecting): ${bindingInfoText(bindingInfo)}`);
            }
            return;
        }
        if (!newValue) {
            if (config.debug) {
                console.log(`unmount if content : ${bindingInfoText(bindingInfo)}`);
            }
            content.unmount();
        }
        if (newValue) {
            if (config.debug) {
                console.log(`mount if content : ${bindingInfoText(bindingInfo)}`);
            }
            content.mountAfter(bindingInfo.node);
            if (!initialized) {
                const bindings = getBindingsByContent(content);
                for (const bindingInfo of bindings) {
                    applyChange(bindingInfo, state, stateName);
                }
            }
        }
    }
    finally {
        lastValueByNode.set(bindingInfo.node, newValue);
        lastConnectedByNode.set(bindingInfo.node, currentConnected);
    }
}
//# sourceMappingURL=applyChangeToIf.js.map
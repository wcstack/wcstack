import { config } from "../config";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { activateContent, deactivateContent } from "../structural/activateContent";
import { getContentSetByNode } from "../structural/contentsByNode";
import { createContent } from "../structural/createContent";
const lastConnectedByNode = new WeakMap();
function bindingInfoText(bindingInfo) {
    return `${bindingInfo.bindingType} ${bindingInfo.statePathName} ${bindingInfo.outFilters.map(f => f.filterName).join('|')} ${bindingInfo.node.isConnected ? '(connected)' : '(disconnected)'}`;
}
export function applyChangeToIf(bindingInfo, context, rawNewValue) {
    const currentConnected = bindingInfo.node.isConnected;
    const newValue = Boolean(rawNewValue);
    let content;
    const contents = getContentSetByNode(bindingInfo.node);
    if (contents.size === 0) {
        content = createContent(bindingInfo);
    }
    else {
        content = contents.values().next().value;
    }
    try {
        if (!newValue) {
            if (config.debug) {
                console.log(`unmount if content : ${bindingInfoText(bindingInfo)}`);
            }
            content.unmount();
            deactivateContent(content);
        }
        if (newValue) {
            if (config.debug) {
                console.log(`mount if content : ${bindingInfoText(bindingInfo)}`);
            }
            content.mountAfter(bindingInfo.node);
            const loopContext = getLoopContextByNode(bindingInfo.node);
            activateContent(content, loopContext, context);
        }
    }
    finally {
        lastConnectedByNode.set(bindingInfo.node, currentConnected);
    }
}
//# sourceMappingURL=applyChangeToIf.js.map
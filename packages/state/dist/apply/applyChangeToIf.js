import { config } from "../config";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { activateContent, deactivateContent } from "../structural/activateContent";
import { getContentByNode } from "../structural/contentByNode";
import { createContent } from "../structural/createContent";
const lastConnectedByNode = new WeakMap();
function bindingInfoText(bindingInfo) {
    return `${bindingInfo.bindingType} ${bindingInfo.statePathName} ${bindingInfo.outFilters.map(f => f.filterName).join('|')} ${bindingInfo.node.isConnected ? '(connected)' : '(disconnected)'}`;
}
export function applyChangeToIf(bindingInfo, context, rawNewValue) {
    const currentConnected = bindingInfo.node.isConnected;
    const newValue = Boolean(rawNewValue);
    let content = getContentByNode(bindingInfo.node);
    if (content === null) {
        content = createContent(bindingInfo);
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
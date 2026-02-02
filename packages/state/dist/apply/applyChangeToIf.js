import { getBindingsByContent } from "../bindings/bindingsByContent";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { getContentByNode } from "../structural/contentByNode";
import { createContent } from "../structural/createContent";
import { applyChange } from "./applyChange";
const lastValueByNode = new WeakMap();
export function applyChangeToIf(bindingInfo, _newValue, state, stateName) {
    const oldValue = lastValueByNode.get(bindingInfo.node) ?? false;
    const newValue = Boolean(_newValue);
    let content = getContentByNode(bindingInfo.node);
    let initialized = false;
    if (content === null) {
        const loopContext = getLoopContextByNode(bindingInfo.node);
        content = createContent(bindingInfo, loopContext);
        initialized = true;
    }
    if (oldValue === newValue && content.mounted) {
        return;
    }
    if (!newValue) {
        content.unmount();
    }
    if (newValue) {
        content.mountAfter(bindingInfo.node);
        if (!initialized) {
            const bindings = getBindingsByContent(content);
            for (const bindingInfo of bindings) {
                applyChange(bindingInfo, state, stateName);
            }
        }
    }
    lastValueByNode.set(bindingInfo.node, newValue);
}
//# sourceMappingURL=applyChangeToIf.js.map
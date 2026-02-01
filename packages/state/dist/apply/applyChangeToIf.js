import { getBindingsByContent, setBindingsByContent } from "../bindings/bindingsByContent";
import { initializeBindingsByFragment } from "../bindings/initializeBindings";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
import { createContent } from "../structural/createContent";
import { getFragmentInfoByUUID } from "../structural/fragmentInfoByUUID";
import { applyChangeFromBindings } from "./applyChangeFromBindings";
const lastValueByNode = new WeakMap();
const contentByNode = new WeakMap();
export function applyChangeToIf(node, uuid, _newValue) {
    const fragmentInfo = getFragmentInfoByUUID(uuid);
    if (!fragmentInfo) {
        raiseError(`Fragment with UUID "${uuid}" not found.`);
    }
    const oldValue = lastValueByNode.get(node) ?? false;
    const newValue = Boolean(_newValue);
    let content = contentByNode.get(node);
    let initiaized = false;
    if (typeof content === "undefined") {
        const loopContext = getLoopContextByNode(node);
        const cloneFragment = document.importNode(fragmentInfo.fragment, true);
        const bindings = initializeBindingsByFragment(cloneFragment, fragmentInfo.nodeInfos, loopContext);
        content = createContent(cloneFragment);
        setBindingsByContent(content, bindings);
        contentByNode.set(node, content);
        initiaized = true;
    }
    if (oldValue === newValue) {
        return;
    }
    if (oldValue) {
        content.unmount();
    }
    if (newValue) {
        content.mountAfter(node);
        if (!initiaized) {
            const bindings = getBindingsByContent(content);
            applyChangeFromBindings(bindings);
        }
    }
    lastValueByNode.set(node, newValue);
}
//# sourceMappingURL=applyChangeToIf.js.map
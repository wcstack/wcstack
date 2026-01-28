import { initializeBindingsByFragment } from "../bindings/initializeBindings";
import { getListIndexesByList } from "../list/listIndexesByList";
import { raiseError } from "../raiseError";
import { createContent } from "../structural/createContent";
import { getFragmentInfoByUUID } from "../structural/fragmentInfoByUUID";
const lastValueByNode = new WeakMap();
const lastContentsByNode = new WeakMap();
export function applyChangeToFor(node, uuid, _newValue) {
    const fragmentInfo = getFragmentInfoByUUID(uuid);
    if (!fragmentInfo) {
        raiseError(`Fragment with UUID "${uuid}" not found.`);
    }
    const lastValue = lastValueByNode.get(node) ?? [];
    const newValue = Array.isArray(_newValue) ? _newValue : [];
    const listIndexes = getListIndexesByList(newValue) || [];
    const lastContents = lastContentsByNode.get(node) || [];
    for (const content of lastContents) {
        content.unmount();
    }
    const newContents = [];
    let lastNode = node;
    for (const index of listIndexes) {
        const cloneFragment = document.importNode(fragmentInfo.fragment, true);
        initializeBindingsByFragment(cloneFragment, fragmentInfo.nodeInfos, index);
        const content = createContent(cloneFragment);
        content.mountAfter(lastNode);
        lastNode = content.lastNode || lastNode;
        newContents.push(content);
    }
    lastContentsByNode.set(node, newContents);
    lastValueByNode.set(node, newValue);
}
//# sourceMappingURL=applyChangeToFor.js.map
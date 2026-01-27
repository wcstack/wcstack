import { getListIndexesByList } from "../list/listIndexesByList";
import { raiseError } from "../raiseError";
import { createContent } from "../structural/createContent";
import { getFragmentByUUID } from "../structural/fragmentByUUID";
const lastValueByNode = new WeakMap();
const lastContentsByNode = new WeakMap();
export function applyChangeToFor(node, uuid, _newValue) {
    const fragment = getFragmentByUUID(uuid);
    if (!fragment) {
        raiseError(`Fragment with UUID "${uuid}" not found.`);
    }
    const lastValue = lastValueByNode.get(node) ?? [];
    const newValue = Array.isArray(_newValue) ? _newValue : [];
    const listIndexes = getListIndexesByList(newValue) || [];
    const parentNode = node.parentNode;
    const nextSilbling = node.nextSibling;
    const lastContents = lastContentsByNode.get(node) || [];
    for (const content of lastContents) {
        content.unmount();
    }
    const newContents = [];
    let lastNode = node;
    for (const index of listIndexes) {
        const cloneFragment = document.importNode(fragment, true);
        const content = createContent(cloneFragment);
        content.mountAfter(lastNode);
        lastNode = content.lastNode || lastNode;
    }
    lastContentsByNode.set(node, newContents);
    lastValueByNode.set(node, newValue);
}
//# sourceMappingURL=applyChangeToFor.js.map
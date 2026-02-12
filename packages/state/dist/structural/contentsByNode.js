import { createEmptySet } from "../createEmptySet";
const contentSetByNode = new WeakMap();
const EMPTY_SET = createEmptySet();
export function setContentByNode(node, content) {
    const contents = contentSetByNode.get(node);
    if (contents) {
        contents.add(content);
    }
    else {
        contentSetByNode.set(node, new Set([content]));
    }
}
export function getContentSetByNode(node) {
    const contents = contentSetByNode.get(node);
    if (typeof contents !== "undefined") {
        return contents;
    }
    return EMPTY_SET;
}
export function deleteContentByNode(node, content) {
    const contents = contentSetByNode.get(node);
    if (contents) {
        contents.delete(content);
        if (contents.size === 0) {
            contentSetByNode.delete(node);
        }
    }
}
//# sourceMappingURL=contentsByNode.js.map
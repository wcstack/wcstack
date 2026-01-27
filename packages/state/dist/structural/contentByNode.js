const contentByNode = new WeakMap();
export function setContentByNode(node, content) {
    if (content === null) {
        contentByNode.delete(node);
    }
    else {
        contentByNode.set(node, content);
    }
}
export function getContentByNode(node) {
    return contentByNode.get(node) || null;
}
//# sourceMappingURL=contentByNode.js.map
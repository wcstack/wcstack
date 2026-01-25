const listIndexByNode = new WeakMap();
export function getListIndexByNode(node) {
    return listIndexByNode.get(node) || null;
}
export function setListIndexByNode(node, listIndex) {
    if (listIndex === null) {
        listIndexByNode.delete(node);
        return;
    }
    listIndexByNode.set(node, listIndex);
}
//# sourceMappingURL=listIndexByNode.js.map
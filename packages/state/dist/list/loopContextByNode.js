const loopContextByNode = new WeakMap();
export function getLoopContextByNode(node) {
    return loopContextByNode.get(node) || null;
}
export function setLoopContextByNode(node, loopContext) {
    if (loopContext === null) {
        loopContextByNode.delete(node);
        return;
    }
    loopContextByNode.set(node, loopContext);
}
//# sourceMappingURL=loopContextByNode.js.map
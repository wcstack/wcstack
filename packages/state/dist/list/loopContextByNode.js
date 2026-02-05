const loopContextByNode = new WeakMap();
export function getLoopContextByNode(node) {
    let paramNode = node;
    while (paramNode) {
        const loopContext = loopContextByNode.get(paramNode);
        if (loopContext) {
            return loopContext;
        }
        paramNode = paramNode.parentNode;
    }
    return null;
}
export function setLoopContextByNode(node, loopContext) {
    if (loopContext === null) {
        loopContextByNode.delete(node);
        return;
    }
    loopContextByNode.set(node, loopContext);
}
//# sourceMappingURL=loopContextByNode.js.map
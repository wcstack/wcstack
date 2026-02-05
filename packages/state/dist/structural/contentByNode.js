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
    let currentNode = node;
    while (currentNode) {
        const loopContext = contentByNode.get(currentNode);
        if (loopContext) {
            return loopContext;
        }
        currentNode = currentNode.parentNode;
    }
    return null;
}
//# sourceMappingURL=contentByNode.js.map
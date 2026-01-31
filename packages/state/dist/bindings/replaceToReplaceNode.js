export function replaceToReplaceNode(bindingInfo) {
    const node = bindingInfo.node;
    const replaceNode = bindingInfo.replaceNode;
    if (node === replaceNode) {
        return;
    }
    if (node.parentNode === null) {
        // already replaced
        return;
    }
    node.parentNode.replaceChild(replaceNode, node);
}
//# sourceMappingURL=replaceToReplaceNode.js.map
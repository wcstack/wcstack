const nodesByContent = new WeakMap();
export function getNodesByContent(content) {
    return nodesByContent.get(content) ?? [];
}
export function setNodesByContent(content, nodes) {
    nodesByContent.set(content, nodes);
}
//# sourceMappingURL=nodesByContent.js.map
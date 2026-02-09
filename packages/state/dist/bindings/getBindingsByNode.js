const bindingsByNode = new WeakMap();
export function getBindingsByNode(node) {
    return bindingsByNode.get(node) || null;
}
export function setBindingsByNode(node, bindings) {
    bindingsByNode.set(node, bindings);
}
//# sourceMappingURL=getBindingsByNode.js.map
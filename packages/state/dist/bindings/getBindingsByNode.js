const bindingsByNode = new WeakMap();
export function getBindingsByNode(node) {
    return bindingsByNode.get(node) || null;
}
export function setBindingsByNode(node, bindings) {
    bindingsByNode.set(node, bindings);
}
export function addBindingByNode(node, binding) {
    const bindings = getBindingsByNode(node);
    if (bindings === null) {
        setBindingsByNode(node, [binding]);
    }
    else {
        bindings.push(binding);
    }
}
//# sourceMappingURL=getBindingsByNode.js.map
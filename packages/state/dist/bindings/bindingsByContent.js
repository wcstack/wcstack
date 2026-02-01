const bindingsByContent = new WeakMap();
export function getBindingsByContent(content) {
    return bindingsByContent.get(content) ?? [];
}
export function setBindingsByContent(content, bindings) {
    bindingsByContent.set(content, bindings);
}
//# sourceMappingURL=bindingsByContent.js.map
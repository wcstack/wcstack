const indexBindingsByContent = new WeakMap();
export function getIndexBindingsByContent(content) {
    return indexBindingsByContent.get(content) ?? [];
}
export function setIndexBindingsByContent(content, bindings) {
    indexBindingsByContent.set(content, bindings);
}
//# sourceMappingURL=indexBindingsByContent.js.map
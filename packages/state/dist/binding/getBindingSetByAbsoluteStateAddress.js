const bindingSetByAbsoluteStateAddress = new WeakMap();
export function getBindingSetByAbsoluteStateAddress(absoluteStateAddress) {
    let bindingSet = null;
    bindingSet = bindingSetByAbsoluteStateAddress.get(absoluteStateAddress) || null;
    if (bindingSet === null) {
        bindingSet = new Set();
        bindingSetByAbsoluteStateAddress.set(absoluteStateAddress, bindingSet);
    }
    return bindingSet;
}
export function addBindingByAbsoluteStateAddress(absoluteStateAddress, binding) {
    const bindingSet = getBindingSetByAbsoluteStateAddress(absoluteStateAddress);
    bindingSet.add(binding);
}
export function clearBindingSetByAbsoluteStateAddress(absoluteStateAddress) {
    bindingSetByAbsoluteStateAddress.delete(absoluteStateAddress);
}
export function removeBindingByAbsoluteStateAddress(absoluteStateAddress, binding) {
    const bindingSet = getBindingSetByAbsoluteStateAddress(absoluteStateAddress);
    bindingSet.delete(binding);
}
//# sourceMappingURL=getBindingSetByAbsoluteStateAddress.js.map
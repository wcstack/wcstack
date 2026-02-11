const lastListValueByAbsoluteStateAddress = new WeakMap();
export function getLastListValueByAbsoluteStateAddress(address) {
    return lastListValueByAbsoluteStateAddress.get(address) ?? [];
}
export function setLastListValueByAbsoluteStateAddress(address, value) {
    lastListValueByAbsoluteStateAddress.set(address, value);
}
export function clearLastListValueByAbsoluteStateAddress(address) {
    lastListValueByAbsoluteStateAddress.delete(address);
}
export function hasLastListValueByAbsoluteStateAddress(address) {
    return lastListValueByAbsoluteStateAddress.has(address);
}
//# sourceMappingURL=lastListValueByAbsoluteStateAddress.js.map
// WebComponent専用のキャッシュ
// outerState.tsからのアクセスで、これを返す
const lastValueByAbsoluteStateAddress = new WeakMap();
export function setLastValueByAbsoluteStateAddress(absoluteStateAddress, value) {
    lastValueByAbsoluteStateAddress.set(absoluteStateAddress, value);
}
export function getLastValueByAbsoluteStateAddress(absoluteStateAddress) {
    return lastValueByAbsoluteStateAddress.get(absoluteStateAddress);
}
//# sourceMappingURL=lastValueByAbsoluteStateAddress.js.map
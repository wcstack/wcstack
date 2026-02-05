const bindingInfosByAbsoluteStateAddress = new WeakMap();
export function getBindingInfosByAbsoluteStateAddress(absoluteStateAddress) {
    let bindingInfos = null;
    bindingInfos = bindingInfosByAbsoluteStateAddress.get(absoluteStateAddress) || null;
    if (bindingInfos === null) {
        bindingInfos = [];
        bindingInfosByAbsoluteStateAddress.set(absoluteStateAddress, bindingInfos);
    }
    return bindingInfos;
}
export function addBindingInfoByAbsoluteStateAddress(absoluteStateAddress, bindingInfo) {
    const bindingInfos = getBindingInfosByAbsoluteStateAddress(absoluteStateAddress);
    bindingInfos.push(bindingInfo);
}
export function clearBindingInfosByAbsoluteStateAddress(absoluteStateAddress) {
    bindingInfosByAbsoluteStateAddress.delete(absoluteStateAddress);
}
export function removeBindingInfoByAbsoluteStateAddress(absoluteStateAddress, bindingInfo) {
    const bindingInfos = getBindingInfosByAbsoluteStateAddress(absoluteStateAddress);
    const index = bindingInfos.indexOf(bindingInfo);
    if (index !== -1) {
        bindingInfos.splice(index, 1);
    }
}
//# sourceMappingURL=getBindingInfosByAbsoluteStateAddress.js.map
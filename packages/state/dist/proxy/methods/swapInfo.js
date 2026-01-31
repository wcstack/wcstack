const swapInfoByStateAddress = new WeakMap();
export function getSwapInfoByAddress(address) {
    return swapInfoByStateAddress.get(address) ?? null;
}
export function setSwapInfoByAddress(address, swapInfo) {
    if (swapInfo === null) {
        swapInfoByStateAddress.delete(address);
    }
    else {
        swapInfoByStateAddress.set(address, swapInfo);
    }
}
//# sourceMappingURL=swapInfo.js.map
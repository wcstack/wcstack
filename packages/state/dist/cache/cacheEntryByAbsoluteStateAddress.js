const cacheEntryByAbsoluteStateAddress = new WeakMap();
export function getCacheEntryByAbsoluteStateAddress(address) {
    return cacheEntryByAbsoluteStateAddress.get(address) ?? null;
}
export function setCacheEntryByAbsoluteStateAddress(address, cacheEntry) {
    if (cacheEntry === null) {
        cacheEntryByAbsoluteStateAddress.delete(address);
    }
    else {
        cacheEntryByAbsoluteStateAddress.set(address, cacheEntry);
    }
}
export function dirtyCacheEntryByAbsoluteStateAddress(address) {
    const cacheEntry = cacheEntryByAbsoluteStateAddress.get(address);
    if (cacheEntry) {
        cacheEntry.dirty = true;
    }
}
//# sourceMappingURL=cacheEntryByAbsoluteStateAddress.js.map
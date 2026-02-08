import { WILDCARD } from "../define";
const _cache = new WeakMap();
const _cacheNullListIndex = new WeakMap();
class AbsoluteStateAddress {
    absolutePathInfo;
    listIndex;
    _parentAbsoluteAddress;
    constructor(absolutePathInfo, listIndex) {
        this.absolutePathInfo = absolutePathInfo;
        this.listIndex = listIndex;
    }
    get parentAbsoluteAddress() {
        if (typeof this._parentAbsoluteAddress !== 'undefined') {
            return this._parentAbsoluteAddress;
        }
        const parentAbsolutePathInfo = this.absolutePathInfo.parentAbsolutePathInfo;
        if (parentAbsolutePathInfo === null) {
            return null;
        }
        const lastSegment = this.absolutePathInfo.pathInfo.segments[this.absolutePathInfo.pathInfo.segments.length - 1];
        let parentListIndex = null;
        if (lastSegment === WILDCARD) {
            parentListIndex = this.listIndex?.parentListIndex ?? null;
        }
        else {
            parentListIndex = this.listIndex;
        }
        return this._parentAbsoluteAddress = createAbsoluteStateAddress(parentAbsolutePathInfo, parentListIndex);
    }
}
export function createAbsoluteStateAddress(absolutePathInfo, listIndex) {
    if (listIndex === null) {
        let cached = _cacheNullListIndex.get(absolutePathInfo);
        if (typeof cached !== "undefined") {
            return cached;
        }
        cached = new AbsoluteStateAddress(absolutePathInfo, null);
        _cacheNullListIndex.set(absolutePathInfo, cached);
        return cached;
    }
    else {
        let cacheByAbsolutePathInfo = _cache.get(listIndex);
        if (typeof cacheByAbsolutePathInfo === "undefined") {
            cacheByAbsolutePathInfo = new WeakMap();
            _cache.set(listIndex, cacheByAbsolutePathInfo);
        }
        let cached = cacheByAbsolutePathInfo.get(absolutePathInfo);
        if (typeof cached !== "undefined") {
            return cached;
        }
        cached = new AbsoluteStateAddress(absolutePathInfo, listIndex);
        cacheByAbsolutePathInfo.set(absolutePathInfo, cached);
        return cached;
    }
}
//# sourceMappingURL=AbsoluteStateAddress.js.map
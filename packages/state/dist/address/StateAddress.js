import { WILDCARD } from "../define";
const _cache = new WeakMap();
const _cacheNullListIndex = new WeakMap();
class StateAddress {
    pathInfo;
    listIndex;
    _parentAddress;
    constructor(pathInfo, listIndex) {
        this.pathInfo = pathInfo;
        this.listIndex = listIndex;
    }
    get parentAddress() {
        if (typeof this._parentAddress !== 'undefined') {
            return this._parentAddress;
        }
        const parentPathInfo = this.pathInfo.parentPathInfo;
        if (parentPathInfo === null) {
            return null;
        }
        const lastSegment = this.pathInfo.segments[this.pathInfo.segments.length - 1];
        let parentListIndex = null;
        if (lastSegment === WILDCARD) {
            parentListIndex = this.listIndex?.parentListIndex ?? null;
        }
        else {
            parentListIndex = this.listIndex;
        }
        return this._parentAddress = createStateAddress(parentPathInfo, parentListIndex);
    }
}
export function createStateAddress(pathInfo, listIndex) {
    if (listIndex === null) {
        let cached = _cacheNullListIndex.get(pathInfo);
        if (typeof cached !== "undefined") {
            return cached;
        }
        cached = new StateAddress(pathInfo, null);
        _cacheNullListIndex.set(pathInfo, cached);
        return cached;
    }
    else {
        let cacheByPathInfo = _cache.get(listIndex);
        if (typeof cacheByPathInfo === "undefined") {
            cacheByPathInfo = new WeakMap();
            _cache.set(listIndex, cacheByPathInfo);
        }
        let cached = cacheByPathInfo.get(pathInfo);
        if (typeof cached !== "undefined") {
            return cached;
        }
        cached = new StateAddress(pathInfo, listIndex);
        cacheByPathInfo.set(pathInfo, cached);
        return cached;
    }
}
//# sourceMappingURL=StateAddress.js.map
const _cache = new WeakMap();
export function getAbsolutePathInfo(stateElement, pathInfo) {
    if (_cache.has(stateElement)) {
        const pathMap = _cache.get(stateElement);
        if (pathMap.has(pathInfo)) {
            return pathMap.get(pathInfo);
        }
    }
    else {
        _cache.set(stateElement, new WeakMap());
    }
    const absolutePathInfo = Object.freeze(new AbsolutePathInfo(stateElement, pathInfo));
    _cache.get(stateElement).set(pathInfo, absolutePathInfo);
    return absolutePathInfo;
}
class AbsolutePathInfo {
    pathInfo;
    stateName;
    stateElement;
    parentAbsolutePathInfo;
    constructor(stateElement, pathInfo) {
        this.pathInfo = pathInfo;
        this.stateName = stateElement.name;
        this.stateElement = stateElement;
        if (pathInfo.parentPathInfo === null) {
            this.parentAbsolutePathInfo = null;
        }
        else {
            this.parentAbsolutePathInfo = getAbsolutePathInfo(stateElement, pathInfo.parentPathInfo);
        }
    }
}
//# sourceMappingURL=AbsolutePathInfo.js.map
const _cache = {};
function makeKey(stateName, path) {
    return `${path}@${stateName}`;
}
let id = 0;
export function getAbsolutePathInfo(stateName, pathInfo) {
    const key = makeKey(stateName, pathInfo.path);
    if (_cache[key]) {
        return _cache[key];
    }
    const absolutePathInfo = Object.freeze(new AbsolutePathInfo(stateName, pathInfo));
    _cache[key] = absolutePathInfo;
    return absolutePathInfo;
}
class AbsolutePathInfo {
    pathInfo;
    stateName;
    parentAbsolutePathInfo;
    constructor(stateName, pathInfo) {
        this.pathInfo = pathInfo;
        this.stateName = stateName;
        if (pathInfo.parentPathInfo === null) {
            this.parentAbsolutePathInfo = null;
        }
        else {
            this.parentAbsolutePathInfo = getAbsolutePathInfo(stateName, pathInfo.parentPathInfo);
        }
    }
}
//# sourceMappingURL=AbsolutePathInfo.js.map
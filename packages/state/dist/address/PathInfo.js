import { DELIMITER, WILDCARD } from "../define.js";
const _cache = {};
export function getPathInfo(path) {
    if (_cache[path]) {
        return _cache[path];
    }
    const pathInfo = new PathInfo(path);
    _cache[path] = pathInfo;
    return pathInfo;
}
class PathInfo {
    path = "";
    segments = [];
    wildcardPositions = [];
    wildcardPaths = [];
    wildcardParentPaths = [];
    wildcardPathInfos = [];
    wildcardParentPathInfos = [];
    _parentPathInfo = undefined;
    constructor(path) {
        this.path = path;
        this.segments = path.split(DELIMITER).filter(seg => seg.length > 0);
        this.wildcardPositions = this.segments
            .map((seg, index) => (seg === WILDCARD ? index : -1))
            .filter(index => index !== -1);
        this.wildcardPaths = this.wildcardPositions.map(pos => this.segments.slice(0, pos + 1).join(DELIMITER));
        this.wildcardParentPaths = this.wildcardPositions.map(pos => this.segments.slice(0, pos).join(DELIMITER));
        this.wildcardPathInfos = this.wildcardPaths.map(p => getPathInfo(p));
        this.wildcardParentPathInfos = this.wildcardParentPaths.map(p => getPathInfo(p));
    }
    get parentPathInfo() {
        if (typeof this._parentPathInfo !== "undefined") {
            return this._parentPathInfo;
        }
        if (this.segments.length === 0) {
            return null;
        }
        const parentSegments = this.segments.slice(0, -1);
        const parentPath = parentSegments.join(DELIMITER);
        this._parentPathInfo = getPathInfo(parentPath);
        return this._parentPathInfo;
    }
}
//# sourceMappingURL=PathInfo.js.map
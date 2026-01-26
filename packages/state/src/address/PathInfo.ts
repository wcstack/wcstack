import { DELIMITER, WILDCARD } from "../define.js";
import { IPathInfo } from "./types.js";

const _cache: { [key: string]: PathInfo } = {};

export function getPathInfo(path: string): IPathInfo {
  if (_cache[path]) {
    return _cache[path];
  }
  const pathInfo = new PathInfo(path);
  _cache[path] = pathInfo;
  return pathInfo;
}

class PathInfo implements IPathInfo {
  path: string = "";
  segments: string[] = [];
  wildcardPositions: number[] = [];
  wildcardPaths: string[] = [];
  wildcardParentPaths: string[] = [];
  wildcardPathInfos: IPathInfo[] = [];
  wildcardParentPathInfos: IPathInfo[] = [];
  private _parentPathInfo: IPathInfo | null | undefined = undefined;
  constructor(path: string) {
    this.path = path;
    this.segments = path.split(DELIMITER).filter(seg => seg.length > 0);
    this.wildcardPositions = this.segments
      .map((seg, index) => (seg === WILDCARD ? index : -1))
      .filter(index => index !== -1);
    this.wildcardPaths = this.wildcardPositions.map(pos => this.segments.slice(0, pos + 1).join(DELIMITER));
    this.wildcardParentPaths = this.wildcardPositions.map(pos => this.segments.slice(0, pos).join(DELIMITER));
    this.wildcardPathInfos = this.wildcardPaths.map(p => p === path ? this : getPathInfo(p));
    this.wildcardParentPathInfos = this.wildcardParentPaths.map(p => p === path ? this : getPathInfo(p));
  }

  get parentPathInfo(): IPathInfo | null {
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



import { IAbsolutePathInfo, IPathInfo } from "./types";

const _cache: { [key: string]: IAbsolutePathInfo } = {};

function makeKey(stateName: string, path: string): string {
  return `${path}@${stateName}`;
}

let id: number = 0;
export function getAbsolutePathInfo(stateName: string, pathInfo: IPathInfo): IAbsolutePathInfo {
  const key = makeKey(stateName, pathInfo.path);
  if (_cache[key]) {
    return _cache[key];
  }
  const absolutePathInfo = Object.freeze(new AbsolutePathInfo(stateName, pathInfo));
  _cache[key] = absolutePathInfo;
  return absolutePathInfo;
}

class AbsolutePathInfo implements IAbsolutePathInfo {
  readonly pathInfo: IPathInfo;
  readonly stateName: string;
  readonly parentAbsolutePathInfo: IAbsolutePathInfo | null;
  constructor(stateName: string, pathInfo: IPathInfo) {
    this.pathInfo = pathInfo;
    this.stateName = stateName;
    if (pathInfo.parentPathInfo === null) {
      this.parentAbsolutePathInfo = null;
    } else {
      this.parentAbsolutePathInfo = getAbsolutePathInfo(stateName, pathInfo.parentPathInfo);
    }
  }
}
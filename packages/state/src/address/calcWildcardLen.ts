import { IPathInfo } from "./types.js";

const cacheCalcWildcardLen: WeakMap<IPathInfo, WeakMap<IPathInfo, number>> = new WeakMap(); 

export function calcWildcardLen(pathInfo: IPathInfo, targetPathInfo: IPathInfo): number {
  let path1: IPathInfo;
  let path2: IPathInfo;
  if (pathInfo.wildcardCount === 0 || targetPathInfo.wildcardCount === 0) {
    return 0;
  }
  if (pathInfo.wildcardCount === 1 
    && targetPathInfo.wildcardCount > 0 
    && targetPathInfo.wildcardPathSet.has(pathInfo.path)) {
    return 1;
  }
  if (pathInfo.id < targetPathInfo.id) {
    path1 = pathInfo;
    path2 = targetPathInfo;
  } else {
    path1 = targetPathInfo;
    path2 = pathInfo;
  }
  let cacheByPath2 = cacheCalcWildcardLen.get(path1);
  if (typeof cacheByPath2 === "undefined") {
    cacheByPath2 = new WeakMap<IPathInfo, number>();
    cacheCalcWildcardLen.set(path1, cacheByPath2);
  } else {
    const cached = cacheByPath2.get(path2);
    if (typeof cached !== "undefined") {
      return cached;
    }
  }
  const matchPath = path1.wildcardPathSet.intersection(path2.wildcardPathSet);
  const retValue = matchPath.size;
  cacheByPath2.set(path2, retValue);
  return retValue;
}


import { IPathInfo } from "./types.js";

const cacheCalcWildcardLen: Map<string, number> = new Map(); 

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
  const key = `${path1.path}\t${path2.path}`;
  let len = cacheCalcWildcardLen.get(key);
  if (typeof len !== "undefined") {
    return len;
  }
  const matchPath = path1.wildcardPathSet.intersection(path2.wildcardPathSet);
  len = matchPath.size;
  cacheCalcWildcardLen.set(key, len);
  return len;
}


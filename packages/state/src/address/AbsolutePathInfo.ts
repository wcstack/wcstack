import { IStateElement } from "../components/types";
import { IAbsolutePathInfo, IPathInfo } from "./types";

const _cache: WeakMap<IStateElement, WeakMap<IPathInfo, IAbsolutePathInfo>> = new WeakMap();

export function getAbsolutePathInfo(stateElement: IStateElement, pathInfo: IPathInfo): IAbsolutePathInfo {
  if (_cache.has(stateElement)) {
    const pathMap = _cache.get(stateElement)!;
    if (pathMap.has(pathInfo)) {
      return pathMap.get(pathInfo)!;
    }
  } else {
    _cache.set(stateElement, new WeakMap());
  }
  const absolutePathInfo = Object.freeze(new AbsolutePathInfo(stateElement, pathInfo));
  _cache.get(stateElement)!.set(pathInfo, absolutePathInfo);
  return absolutePathInfo;
}

class AbsolutePathInfo implements IAbsolutePathInfo {
  readonly pathInfo: IPathInfo;
  readonly stateName: string;
  readonly stateElement: IStateElement;
  readonly parentAbsolutePathInfo: IAbsolutePathInfo | null;
  constructor(stateElement: IStateElement, pathInfo: IPathInfo) {
    this.pathInfo = pathInfo;
    this.stateName = stateElement.name;
    this.stateElement = stateElement;
    if (pathInfo.parentPathInfo === null) {
      this.parentAbsolutePathInfo = null;
    } else {
      this.parentAbsolutePathInfo = getAbsolutePathInfo(stateElement, pathInfo.parentPathInfo);
    }
  }
}
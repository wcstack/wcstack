import { IStateElement } from "../components/types";
import { ITreePath, IPathInfo } from "./types";

const _cache: WeakMap<IStateElement, WeakMap<IPathInfo, ITreePath>> = new WeakMap();

export function getTreePath(stateElement: IStateElement, pathInfo: IPathInfo): ITreePath {
  if (_cache.has(stateElement)) {
    const pathMap = _cache.get(stateElement)!;
    if (pathMap.has(pathInfo)) {
      return pathMap.get(pathInfo)!;
    }
  } else {
    _cache.set(stateElement, new WeakMap());
  }
  const absolutePathInfo = Object.freeze(new TreePath(stateElement, pathInfo));
  _cache.get(stateElement)!.set(pathInfo, absolutePathInfo);
  return absolutePathInfo;
}

class TreePath implements ITreePath {
  readonly pathInfo: IPathInfo;
  readonly stateElement: IStateElement;
  readonly parentAbsolutePathInfo: ITreePath | null;
  constructor(stateElement: IStateElement, pathInfo: IPathInfo) {
    this.pathInfo = pathInfo;
    this.stateElement = stateElement;
    if (pathInfo.parentPathInfo === null) {
      this.parentAbsolutePathInfo = null;
    } else {
      this.parentAbsolutePathInfo = getTreePath(stateElement, pathInfo.parentPathInfo);
    }
  }
}
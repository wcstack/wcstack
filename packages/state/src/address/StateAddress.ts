import { WILDCARD } from "../define";
import { IListIndex } from "../list/types";
import { IPathInfo, IStateAddress } from "./types";

const _cache: WeakMap<IListIndex, WeakMap<IPathInfo, IStateAddress>> = new WeakMap();
const _cacheNullListIndex: WeakMap<IPathInfo, IStateAddress> = new WeakMap();

class StateAddress implements IStateAddress {
  readonly pathInfo: IPathInfo;
  readonly listIndex: IListIndex | null;
  private _parentAddress: IStateAddress | null | undefined;

  constructor(pathInfo: IPathInfo, listIndex: IListIndex | null) {
    this.pathInfo = pathInfo;
    this.listIndex = listIndex;
  }

  get parentAddress(): IStateAddress | null {
    if (typeof this._parentAddress !== 'undefined') {
      return this._parentAddress;
    }
    const parentPathInfo = this.pathInfo.parentPathInfo;
    if (parentPathInfo === null) {
      return null;
    }
    const lastSegment = this.pathInfo.segments[this.pathInfo.segments.length - 1];
    let parentListIndex: IListIndex | null = null;
    if (lastSegment === WILDCARD) {
      parentListIndex = this.listIndex?.parentListIndex ?? null;
    } else {
      parentListIndex = this.listIndex;
    }
    return this._parentAddress = createStateAddress(parentPathInfo, parentListIndex);
  }
}

export function createStateAddress(pathInfo: IPathInfo, listIndex: IListIndex | null): IStateAddress {
  if (listIndex === null) {
    let cached = _cacheNullListIndex.get(pathInfo);
    if (typeof cached !== "undefined") {
      return cached;
    }
    cached = new StateAddress(pathInfo, null);
    _cacheNullListIndex.set(pathInfo, cached);
    return cached;
  } else {
    let cacheByPathInfo = _cache.get(listIndex);
    if (typeof cacheByPathInfo === "undefined") {
      cacheByPathInfo = new WeakMap<IPathInfo, IStateAddress>();
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
import { WILDCARD } from "../define";
import { IListIndex } from "../list/types";
import { IAbsolutePathInfo, IAbsoluteStateAddress } from "./types";

const _cache: WeakMap<IListIndex, WeakMap<IAbsolutePathInfo, IAbsoluteStateAddress>> = new WeakMap();
const _cacheNullListIndex: WeakMap<IAbsolutePathInfo, IAbsoluteStateAddress> = new WeakMap();

class AbsoluteStateAddress implements IAbsoluteStateAddress {
  readonly absolutePathInfo: IAbsolutePathInfo;
  readonly listIndex: IListIndex | null;
  private _parentAbsoluteAddress: IAbsoluteStateAddress | null | undefined;

  constructor(absolutePathInfo: IAbsolutePathInfo, listIndex: IListIndex | null) {
    this.absolutePathInfo = absolutePathInfo;
    this.listIndex = listIndex;
  }

  get parentAbsoluteAddress(): IAbsoluteStateAddress | null {
    if (typeof this._parentAbsoluteAddress !== 'undefined') {
      return this._parentAbsoluteAddress;
    }
    const parentAbsolutePathInfo = this.absolutePathInfo.parentAbsolutePathInfo;
    if (parentAbsolutePathInfo === null) {
      return null;
    }
    const lastSegment = this.absolutePathInfo.pathInfo.segments[this.absolutePathInfo.pathInfo.segments.length - 1];
    let parentListIndex: IListIndex | null = null;
    if (lastSegment === WILDCARD) {
      parentListIndex = this.listIndex?.parentListIndex ?? null;
    } else {
      parentListIndex = this.listIndex;
    }
    return this._parentAbsoluteAddress = createAbsoluteStateAddress(
      parentAbsolutePathInfo,
      parentListIndex
    );
  }
}

export function createAbsoluteStateAddress(absolutePathInfo: IAbsolutePathInfo, listIndex: IListIndex | null): IAbsoluteStateAddress {
  if (listIndex === null) {
    let cached = _cacheNullListIndex.get(absolutePathInfo);
    if (typeof cached !== "undefined") {
      return cached;
    }
    cached = new AbsoluteStateAddress(absolutePathInfo, null);
    _cacheNullListIndex.set(absolutePathInfo, cached);
    return cached;
  } else {
    let cacheByAbsolutePathInfo = _cache.get(listIndex);
    if (typeof cacheByAbsolutePathInfo === "undefined") {
      cacheByAbsolutePathInfo = new WeakMap<IAbsolutePathInfo, IAbsoluteStateAddress>();
      _cache.set(listIndex, cacheByAbsolutePathInfo);
    }
    let cached = cacheByAbsolutePathInfo.get(absolutePathInfo);
    if (typeof cached !== "undefined") {
      return cached;
    }
    cached = new AbsoluteStateAddress(absolutePathInfo, listIndex);
    cacheByAbsolutePathInfo.set(absolutePathInfo, cached);
    return cached;
  }
}

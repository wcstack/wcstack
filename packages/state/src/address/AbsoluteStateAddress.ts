import { IListIndex } from "../list/types";
import { ITreePath, IAbsoluteStateAddress } from "./types";

const _cache: WeakMap<IListIndex, WeakMap<ITreePath, IAbsoluteStateAddress>> = new WeakMap();
const _cacheNullListIndex: WeakMap<ITreePath, IAbsoluteStateAddress> = new WeakMap();

class AbsoluteStateAddress implements IAbsoluteStateAddress {
  readonly absolutePathInfo: ITreePath;
  readonly listIndex: IListIndex | null;

  constructor(absolutePathInfo: ITreePath, listIndex: IListIndex | null) {
    this.absolutePathInfo = absolutePathInfo;
    this.listIndex = listIndex;
  }
}

export function createAbsoluteStateAddress(absolutePathInfo: ITreePath, listIndex: IListIndex | null): IAbsoluteStateAddress {
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
      cacheByAbsolutePathInfo = new WeakMap<ITreePath, IAbsoluteStateAddress>();
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

import { WILDCARD } from "../define";
import { IListIndex } from "../list/types";
import { getListIndexValue } from "../list/createListIndex";
import { getListIndexesByList } from "../list/listIndexesByList";
import { IPathInfo, IStateAddress } from "./types";

const _cache: WeakMap<IListIndex, WeakMap<IPathInfo, IStateAddress>> = new WeakMap();
const _cacheNullListIndex: WeakMap<IPathInfo, IStateAddress> = new WeakMap();

class StateAddress implements IStateAddress {
  readonly pathInfo: IPathInfo;
  readonly listIndex: IListIndex | null;
  private _parentAddress: IStateAddress | undefined;
  /** 行のアドレス（末尾がワイルドカードで行を持つ）。親のアドレスは行の親に付いて変わる */
  private readonly _rowAddress: boolean;

  constructor(pathInfo: IPathInfo, listIndex: IListIndex | null) {
    this.pathInfo = pathInfo;
    this.listIndex = listIndex;
    this._rowAddress = listIndex !== null && pathInfo.lastSegment === WILDCARD;
  }

  /**
   * 行のアドレス（末尾がワイルドカード）の親は、行の**いまの**親から引く。行の親は台帳が付け替える（外側の行を作り直した・
   * 外側の行が内側の配列を手放した — list/listIndexesByList.ts の #256 / #394）。憶えた親を使い続けると、付け替えの後の
   * 読み書きが、もうその配列を持たない外側の行を経由して別の配列に着地した（#393 / #394）。ただし、いまの親がこのアドレスの
   * キーではこの行の配列を持たず、憶えた親が持つなら、憶えた親を使う — 同じ配列を外側の行ごとに別のキー（`items` と `alt`）に
   * 持つと、行の親はどちらか一方のキーにしか合わない（R1・f6 dual）
   */
  get parentAddress(): IStateAddress | null {
    const cached = this._parentAddress;
    if (typeof cached !== 'undefined' && (!this._rowAddress || cached.listIndex === this.listIndex!.parentListIndex)) {
      return cached;
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
    const next = createStateAddress(parentPathInfo, parentListIndex);
    if (typeof cached !== 'undefined' && !holdsRow(next, this.listIndex!) && holdsRow(cached, this.listIndex!)) {
      return cached;
    }
    return this._parentAddress = next;
  }
}

/** 外側の行のアドレス `address`（`groups.*.items`）の配列が、行 `row` をその位置に持つか（要素のオブジェクトを素で読む） */
function holdsRow(address: IStateAddress, row: IListIndex): boolean {
  const pathInfo = address.pathInfo;
  let value = getListIndexValue(address.listIndex!);
  for (const segment of pathInfo.segments.slice(pathInfo.wildcardPositions[pathInfo.wildcardCount - 1] + 1)) {
    value = Object(value)[segment];
  }
  return getListIndexesByList(value as unknown[])?.[row.index] === row;
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
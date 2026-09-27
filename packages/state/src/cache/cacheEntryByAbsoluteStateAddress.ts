import { IAbsoluteStateAddress } from "../address/types";
import { ICacheEntry } from "./types";

const cacheEntryByAbsoluteStateAddress: WeakMap<IAbsoluteStateAddress, ICacheEntry> = new WeakMap();

export function getCacheEntryByAbsoluteStateAddress(
  address: IAbsoluteStateAddress
): ICacheEntry | null {
  return cacheEntryByAbsoluteStateAddress.get(address) ?? null;
}

export function setCacheEntryByAbsoluteStateAddress(
  address: IAbsoluteStateAddress,
  cacheEntry: ICacheEntry | null
): void {
  if (cacheEntry === null) {
    cacheEntryByAbsoluteStateAddress.delete(address);
  } else {
    cacheEntryByAbsoluteStateAddress.set(address, cacheEntry);
    // 行の値（ワイルドカードを含むパス）は行ごとに載るので、要素パスからの静的な辺に載せ、要素の書き込み・
    // `$postUpdate` の依存ウォークが届くようにする（#364）。辺はバインドが張るので、行の中を描いていない
    // リストでは、直接添字・`$getAll`・getter が読んで載せた子のパスに届かず、古い値が返り続けた。
    // 2 回目からは登録済みのパスの判定 1 回で抜ける（State.setPathInfo）
    const { stateElement, pathInfo } = address.absolutePathInfo;
    if (pathInfo.wildcardCount > 0) {
      stateElement.setPathInfo(pathInfo.path, "prop", "internal");
    }
  }
}

export function dirtyCacheEntryByAbsoluteStateAddress(
  address: IAbsoluteStateAddress
): void {
  const cacheEntry = cacheEntryByAbsoluteStateAddress.get(address);
  if (cacheEntry) {
    cacheEntry.dirty = true;
  }
}
import { IAbsoluteStateAddress, IPathInfo } from "../address/types";
import { advanceRowCacheStamp } from "../list/createListIndex";
import { ICacheEntry } from "./types";

const cacheEntryByAbsoluteStateAddress: WeakMap<IAbsoluteStateAddress, ICacheEntry> = new WeakMap();

/**
 * 同じ行の下に子孫のパスがキャッシュに載ったことのあるパス（`items.*.m.k0` を載せると `items.*.m` と
 * `items.*`）。このパスの値を無効にすると、行の印を進めて子孫の項目をまとめて外す（#389）。
 * パスの単位で state を問わない — 別の state が載せた分で印を進めても、読み直しが増えるだけ。
 */
const rowCacheParents: WeakSet<IPathInfo> = new WeakSet();

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
    // 行の値（ワイルドカードを含むパス）は行ごとに載る。要素の書き込み・`$postUpdate` が子のパスのキャッシュに
    // 届くように（#364）:
    // - 行の下で同じ行の親になるパスに印を付ける。そのパスの値を無効にすると行の印が進み、子のパスの項目は
    //   読みで外れる（dirtyCacheEntryByAbsoluteStateAddress）。子のパスを要素パスからの静的な辺に載せると、
    //   要素の書き込みの依存ウォークの費用が行の下で読んだパスの数に比例した（#389 — 動的なキー 1 万個で
    //   1 回 約 5 ms）。
    // - 静的な辺に載せるのはリストの連なり（`items → items.*`）だけ。`for` で描いていないリストでも、リストへの
    //   代入・`$postUpdate("items")` の依存ウォークが行へ届く。
    // 子のパスを読む getter へは、依存の辺が同じ行の親からも張られる（State.addDynamicDependency）。
    // 2 回目からは印の判定と登録済みのパスの判定（State.setPathInfo）1 回ずつで抜ける
    const { stateElement, pathInfo } = address.absolutePathInfo;
    if (pathInfo.wildcardCount > 0) {
      for (let parent = pathInfo.parentPathInfo;
        parent !== null && parent.wildcardCount === pathInfo.wildcardCount && !rowCacheParents.has(parent);
        parent = parent.parentPathInfo) {
        rowCacheParents.add(parent);
      }
      stateElement.setPathInfo(pathInfo.lastWildcardPath!, "prop", "internal");
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
  // 同じ行の下に載った子孫のパスの項目もまとめて外す（#389）。無効にするのは値が変わりうるときで、その下の
  // 値も変わりうる
  if (address.listIndex !== null && rowCacheParents.has(address.absolutePathInfo.pathInfo)) {
    advanceRowCacheStamp(address.listIndex);
  }
}

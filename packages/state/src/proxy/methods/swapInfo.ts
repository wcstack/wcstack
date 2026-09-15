import { ISwapInfo } from "./types";

/**
 * 要素書き込みで入れ替え中のリストの「書き込む前の並び」。キーはリストの配列そのもの —
 * 台帳（listIndexesByList）と同じ単位にそろえる。アドレスはパスと listIndex でキャッシュされ
 * `<wcs-state>` を区別しないので、アドレスをキーにすると、別の state 要素や置き換え前の配列で
 * 揃わなかった入れ替えの記録を拾ってしまう。
 */
const swapInfoByList: WeakMap<object, ISwapInfo> = new WeakMap();

export function getSwapInfoByList(list: object): ISwapInfo | null {
  return swapInfoByList.get(list) ?? null;
}

export function setSwapInfoByList(list: object, swapInfo: ISwapInfo | null): void {
  if (swapInfo === null) {
    swapInfoByList.delete(list);
  } else {
    swapInfoByList.set(list, swapInfo);
  }
}

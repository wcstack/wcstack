import { IAbsoluteStateAddress } from "../address/types";
import { IListIndex } from "./types";
import { getListIndexesByList, isRetiredListIndex } from "./listIndexesByList";

const lastListValueByAbsoluteStateAddress: WeakMap<IAbsoluteStateAddress, readonly unknown[]> = new WeakMap();

/**
 * 上の記録の逆引き（#379）: state 要素ごとに、配列 → その配列をいま描画の基準にしているアドレス。
 * 同じ配列を別のアドレスの `for` も描いている（2 つの外側の行が同じ内側の配列を持つ・同じ行の別パス）とき、
 * 要素書き込みの入れ替えが揃ったら、その `for` にも書き込む前の並びからの差分で描き直させる（setByAddress の
 * notifySwappedList → 下の markSwappedList）。state 要素ごとに分けるのは、別の state の `for` を描き直させず、
 * 捨てた state を配列から持ち続けないため。退役した行（リストから外した外側の行）とその下のアドレスは、集合が
 * 前に見直したときの 2 倍に育ったときに外す（行の数に比例する手間で、外した外側の行を持ち続けない）。
 */
const addressesByListByStateElement: WeakMap<object, WeakMap<readonly unknown[], Set<IAbsoluteStateAddress>>> = new WeakMap();
const NO_ADDRESSES: ReadonlySet<IAbsoluteStateAddress> = new Set<IAbsoluteStateAddress>();
/** 逆引きの集合を次に見直す大きさ（退役した行の下のアドレスを外す — setLastListValueByAbsoluteStateAddress） */
const sweepAtByAddresses: WeakMap<Set<IAbsoluteStateAddress>, number> = new WeakMap();
const SWEEP_MIN = 8;

/**
 * 同じ配列を描く別の `for` のアドレス → 要素書き込みの入れ替えが揃ったその配列（#379）。そのアドレスの `for`（同じ行を
 * 描く `for` が 2 つあれば両方）が描くときに見て（isSwappedList — applyChangeToFor）、描いた後の記録（上の set）で
 * 消える。まだその配列を描くなら、自分が描いた並び（入れ替えの前の写しへ移された #320 の記録）との差分を取る。
 * 基準そのもの（上の記録）は差し替えない — 同じバッチでその `for` のパスへ別の配列を書いていたら、いままでの基準との
 * 差分（#320 の突き合わせ）で描く。写しを基準にすると、差分が新しい配列の行を引き直し、その行が写しの行集合の
 * 持ち主の外側の行へ付け替わる（#256）。
 */
const swappedListByAddress: WeakMap<IAbsoluteStateAddress, readonly unknown[]> = new WeakMap();

function addressesByListOf(address: IAbsoluteStateAddress): WeakMap<readonly unknown[], Set<IAbsoluteStateAddress>> {
  const stateElement = address.absolutePathInfo.stateElement;
  let addressesByList = addressesByListByStateElement.get(stateElement);
  if (typeof addressesByList === "undefined") {
    addressesByList = new WeakMap();
    addressesByListByStateElement.set(stateElement, addressesByList);
  }
  return addressesByList;
}

export function getLastListValueByAbsoluteStateAddress(address: IAbsoluteStateAddress): readonly unknown[] {
  return lastListValueByAbsoluteStateAddress.get(address) ?? [];
}

export function setLastListValueByAbsoluteStateAddress(address: IAbsoluteStateAddress, value: readonly unknown[]): void {
  const previous = lastListValueByAbsoluteStateAddress.get(address);
  lastListValueByAbsoluteStateAddress.set(address, value);
  swappedListByAddress.delete(address);
  const addressesByList = addressesByListOf(address);
  if (previous !== value && typeof previous !== "undefined") {
    addressesByList.get(previous)!.delete(address);
  }
  const addresses = addressesByList.get(value);
  if (typeof addresses === "undefined") {
    addressesByList.set(value, new Set([address]));
  } else if (!addresses.has(address)) {
    // 足すたびに全部を見ると、同じ配列を N 行が持つページの描画が N² になる。集合が前に見た後の 2 倍に育ったときだけ見る
    if (addresses.size >= (sweepAtByAddresses.get(addresses) ?? SWEEP_MIN)) {
      addresses.forEach((held) => {
        if (isUnderRetiredRow(held.listIndex)) {
          addresses.delete(held);
        }
      });
      sweepAtByAddresses.set(addresses, Math.max(SWEEP_MIN, addresses.size * 2));
    }
    addresses.add(address);
  }
}

/**
 * アドレスの行か、その祖先の行が退役しているか。外側の行をリストから外すと、その下の行（3 段なら中の行）は
 * 差分を通らないので退役の印が付かない — 祖先まで見ないと、作り直すたびに外したアドレスが残り続ける
 */
function isUnderRetiredRow(listIndex: IListIndex | null): boolean {
  for (let row = listIndex; row !== null; row = row.parentListIndex) {
    if (isRetiredListIndex(row)) {
      return true;
    }
  }
  return false;
}

/**
 * この state 要素で、この配列をいま描画の基準にしているアドレス（`address` の state 要素で引く）。退役した行の下の
 * アドレスはここでも外す — 外側の行を減らした後の要素書き込みが、外した行の `for` を毎回数えないように
 */
export function getAddressesByLastListValue(address: IAbsoluteStateAddress, value: readonly unknown[]): ReadonlySet<IAbsoluteStateAddress> {
  const addresses = addressesByListOf(address).get(value);
  if (typeof addresses === "undefined") {
    return NO_ADDRESSES;
  }
  addresses.forEach((held) => {
    if (isUnderRetiredRow(held.listIndex)) {
      addresses.delete(held);
    }
  });
  return addresses;
}

/** 同じ配列を描く別の `for` に、その配列の入れ替えが揃ったことを知らせる（上の swappedListByAddress）。もう知らせてあれば偽 */
export function markSwappedList(address: IAbsoluteStateAddress, list: readonly unknown[]): boolean {
  if (swappedListByAddress.has(address)) {
    return false;
  }
  swappedListByAddress.set(address, list);
  return true;
}

/**
 * 入れ替えが揃ったと知らされていて、いま描く値がその配列か。同じ中身の写し（同じバッチで
 * `[...items]` を書いた）は元の配列の台帳をそのまま持つので、同じ配列として扱う
 */
export function isSwappedList(address: IAbsoluteStateAddress, value: unknown): boolean {
  const list = swappedListByAddress.get(address);
  return typeof list !== "undefined" && (list === value || getListIndexesByList(value as unknown[]) === getListIndexesByList(list));
}

export function clearLastListValueByAbsoluteStateAddress(address: IAbsoluteStateAddress): void {
  const previous = lastListValueByAbsoluteStateAddress.get(address);
  lastListValueByAbsoluteStateAddress.delete(address);
  if (typeof previous !== "undefined") {
    addressesByListOf(address).get(previous)!.delete(address);
  }
}

export function hasLastListValueByAbsoluteStateAddress(address: IAbsoluteStateAddress): boolean {
  return lastListValueByAbsoluteStateAddress.has(address);
}

// `for` が描いた並び（#320）の記録は、行の台帳と一緒に持つ（list/listIndexesByList.ts — 台帳を作り直すときに描いた並びを移す・#393）
export { getRenderedList, hasRenderedList, rebaseRenderedList } from "./listIndexesByList";
export type { IRenderedList } from "./listIndexesByList";

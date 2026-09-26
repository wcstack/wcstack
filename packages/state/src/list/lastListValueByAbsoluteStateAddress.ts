import { IAbsoluteStateAddress } from "../address/types";

const lastListValueByAbsoluteStateAddress: WeakMap<IAbsoluteStateAddress, readonly unknown[]> = new WeakMap();

export function getLastListValueByAbsoluteStateAddress(address: IAbsoluteStateAddress): readonly unknown[] {
  return lastListValueByAbsoluteStateAddress.get(address) ?? [];
}

export function setLastListValueByAbsoluteStateAddress(address: IAbsoluteStateAddress, value: readonly unknown[]): void {
  lastListValueByAbsoluteStateAddress.set(address, value);
}

export function clearLastListValueByAbsoluteStateAddress(address: IAbsoluteStateAddress): void {
  lastListValueByAbsoluteStateAddress.delete(address);
}

export function hasLastListValueByAbsoluteStateAddress(address: IAbsoluteStateAddress): boolean {
  return lastListValueByAbsoluteStateAddress.has(address);
}

/**
 * `for` が描いた並び（#320）。1 本の配列につき 1 つで、その配列を描いたどの `for` もこれを指す。
 *
 * 上の記録はアドレスごとに 1 本なので、同じリストを描く `for` が複数あると、画面から外れていて
 * 描かなかった `for`（`if` で消された・DOM から外された）を待たずに進む。そうした `for` は自分が
 * 描いた並びとの差分を取る（applyChangeToFor）。その並びを配列そのもので覚えると、要素書き込みが
 * 配列と台帳をその場で書き換えたときに「描いた並び」が失われるので、ここを 1 段挟む。
 * 要素書き込みの入れ替えが揃ったら、ここを書き込む前の並びの写しに差し替える（rebaseRenderedList）。
 */
export interface IRenderedList {
  value: readonly unknown[];
}

const renderedListByList: WeakMap<readonly unknown[], IRenderedList> = new WeakMap();

export function getRenderedList(list: readonly unknown[]): IRenderedList {
  let rendered = renderedListByList.get(list);
  if (typeof rendered === "undefined") {
    rendered = { value: list };
    renderedListByList.set(list, rendered);
  }
  return rendered;
}

/**
 * 要素書き込みの入れ替えが揃った（setByAddress の notifySwappedList）。この配列をこれまでに描いた `for` が
 * 描いたのは、書き込む前の並び（`image` — 写しと台帳の写し）。以後この配列を描く `for` は新しい並びを指す。
 */
export function rebaseRenderedList(list: readonly unknown[], image: readonly unknown[]): void {
  const rendered = renderedListByList.get(list);
  if (typeof rendered !== "undefined") {
    rendered.value = image;
    renderedListByList.delete(list);
  }
}

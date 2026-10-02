import { describe, it, expect } from 'vitest';
import {
  getLastListValueByAbsoluteStateAddress,
  setLastListValueByAbsoluteStateAddress,
  clearLastListValueByAbsoluteStateAddress,
  hasLastListValueByAbsoluteStateAddress,
  getAddressesByLastListValue,
  isSwappedList,
  markSwappedList,
} from '../src/list/lastListValueByAbsoluteStateAddress';
import { createListIndex } from '../src/list/createListIndex';
import { retireListIndexes, setListIndexesByList } from '../src/list/listIndexesByList';
import type { IAbsoluteStateAddress } from '../src/address/types';
import type { IListIndex } from '../src/list/types';

const defaultStateElement = {};

// 逆引き（getAddressesByLastListValue）は state 要素ごとに持つので、アドレスは state 要素を指す
function createAddress(stateElement: object = defaultStateElement, listIndex: IListIndex | null = null): IAbsoluteStateAddress {
  return {
    absolutePathInfo: { path: 'test', name: 'test', stateElement },
    listIndex,
  } as unknown as IAbsoluteStateAddress;
}

describe('lastListValueByAbsoluteStateAddress', () => {
  it('未登録のアドレスに対してgetは空配列を返すこと', () => {
    const addr = createAddress();
    expect(getLastListValueByAbsoluteStateAddress(addr)).toEqual([]);
  });

  it('未登録のアドレスに対してhasはfalseを返すこと', () => {
    const addr = createAddress();
    expect(hasLastListValueByAbsoluteStateAddress(addr)).toBe(false);
  });

  it('setした値をgetで取得できること', () => {
    const addr = createAddress();
    const value = [1, 2, 3];
    setLastListValueByAbsoluteStateAddress(addr, value);
    expect(getLastListValueByAbsoluteStateAddress(addr)).toBe(value);
    expect(hasLastListValueByAbsoluteStateAddress(addr)).toBe(true);
    clearLastListValueByAbsoluteStateAddress(addr);
  });

  it('clearした後はgetが空配列を返しhasがfalseを返すこと', () => {
    const addr = createAddress();
    setLastListValueByAbsoluteStateAddress(addr, [1]);
    clearLastListValueByAbsoluteStateAddress(addr);
    expect(getLastListValueByAbsoluteStateAddress(addr)).toEqual([]);
    expect(hasLastListValueByAbsoluteStateAddress(addr)).toBe(false);
  });
});

describe('描画の基準の逆引き（#379）', () => {
  it('同じ配列を基準にしているアドレスを、同じ state 要素の分だけ返すこと', () => {
    const list = [1, 2];
    const a = createAddress();
    const b = createAddress();
    const other = createAddress({});
    setLastListValueByAbsoluteStateAddress(a, list);
    setLastListValueByAbsoluteStateAddress(b, list);
    setLastListValueByAbsoluteStateAddress(other, list);
    expect([...getAddressesByLastListValue(a, list)]).toEqual([a, b]);
    expect([...getAddressesByLastListValue(other, list)]).toEqual([other]);
    expect([...getAddressesByLastListValue(a, [1, 2])]).toEqual([]);
  });

  it('基準を別の配列に替える・消すと、前の配列の逆引きから外れること', () => {
    const list = [1];
    const next = [2];
    const a = createAddress();
    const b = createAddress();
    setLastListValueByAbsoluteStateAddress(a, list);
    setLastListValueByAbsoluteStateAddress(b, list);
    setLastListValueByAbsoluteStateAddress(a, next);
    expect([...getAddressesByLastListValue(a, list)]).toEqual([b]);
    expect([...getAddressesByLastListValue(a, next)]).toEqual([a]);
    clearLastListValueByAbsoluteStateAddress(b);
    expect([...getAddressesByLastListValue(a, list)]).toEqual([]);
    // 同じ配列を記録し直しても 1 つのまま
    setLastListValueByAbsoluteStateAddress(a, next);
    expect([...getAddressesByLastListValue(a, next)]).toEqual([a]);
  });

  it('退役した行とその下の行のアドレスは、集合が育ったときに外れ（足すたびには見ない）、引くときにも外れること', () => {
    const list = [1];
    const retiredOuter = createListIndex(null, 0);
    // 外側の行を外しても、その下の行は差分を通らないので退役の印が付かない — 祖先まで見て外す
    const underRetired = createListIndex(retiredOuter, 0);
    const topLevel = createAddress();
    const held = [createAddress(defaultStateElement, retiredOuter), createAddress(defaultStateElement, underRetired), topLevel];
    held.forEach((address) => setLastListValueByAbsoluteStateAddress(address, list));
    const live = Array.from({ length: 5 }, (_, i) => createAddress(defaultStateElement, createListIndex(createListIndex(null, i), 0)));
    live.forEach((address) => setLastListValueByAbsoluteStateAddress(address, list));
    // 集合そのもの（引くと外すので、引き直さずに持つ）
    const addresses = getAddressesByLastListValue(topLevel, list);
    expect([...addresses]).toEqual([...held, ...live]);
    retireListIndexes([retiredOuter]);
    // 8 つになるまでは、足しても見直さない
    expect(addresses.size).toBe(8);
    const next = createAddress();
    setLastListValueByAbsoluteStateAddress(next, list);
    expect([...addresses]).toEqual([topLevel, ...live, next]);
    // 見直した後（残り 6）は、その 2 倍（12）になるまで見直さない
    retireListIndexes([live[0].listIndex!.parentListIndex!]);
    Array.from({ length: 5 }, () => createAddress()).forEach((address) => setLastListValueByAbsoluteStateAddress(address, list));
    expect(addresses.size).toBe(12);
    expect(addresses.has(live[0])).toBe(true);
    setLastListValueByAbsoluteStateAddress(createAddress(), list);
    expect(addresses.has(live[0])).toBe(false);
    expect(addresses.size).toBe(12);
    // 引くときは、退役した行の下のアドレスを外してから返す
    retireListIndexes([live[1].listIndex!.parentListIndex!]);
    expect(getAddressesByLastListValue(topLevel, list).has(live[1])).toBe(false);
    expect(addresses.size).toBe(11);
  });
});

describe('入れ替えが揃ったことの知らせ（#379）', () => {
  it('知らせは 1 回だけ付き、同じ配列か同じ台帳の写しを描くときだけ真で、基準を記録すると消えること', () => {
    const list = [{ v: 1 }];
    // 知らせる配列には必ず台帳がある（入れ替えが揃って台帳を差し替えた配列 — setByAddress の notifySwappedList）
    const rows = [createListIndex(null, 0)];
    setListIndexesByList(list, rows);
    const a = createAddress();
    expect(isSwappedList(a, list)).toBe(false);
    expect(markSwappedList(a, list)).toBe(true);
    expect(markSwappedList(a, list)).toBe(false);
    expect(isSwappedList(a, list)).toBe(true);
    expect(isSwappedList(a, [{ v: 2 }])).toBe(false);
    expect(isSwappedList(a, undefined)).toBe(false);
    // 同じ中身の写しは元の配列の台帳をそのまま持つ（createListDiff の isSameList）
    const copy = [...list];
    setListIndexesByList(copy, rows);
    expect(isSwappedList(a, copy)).toBe(true);
    setLastListValueByAbsoluteStateAddress(a, list);
    expect(isSwappedList(a, list)).toBe(false);
  });
});

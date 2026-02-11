import { describe, it, expect } from 'vitest';
import {
  getLastListValueByAbsoluteStateAddress,
  setLastListValueByAbsoluteStateAddress,
  clearLastListValueByAbsoluteStateAddress,
  hasLastListValueByAbsoluteStateAddress,
} from '../src/list/lastListValueByAbsoluteStateAddress';
import type { IAbsoluteStateAddress } from '../src/address/types';

function createAddress(): IAbsoluteStateAddress {
  return {
    absolutePathInfo: { path: 'test', name: 'test', parentAbsolutePathInfo: null },
    listIndex: null,
    parentAbsoluteAddress: null,
  } as IAbsoluteStateAddress;
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

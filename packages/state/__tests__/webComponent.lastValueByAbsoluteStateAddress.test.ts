import { describe, it, expect } from 'vitest';
import { setLastValueByAbsoluteStateAddress, getLastValueByAbsoluteStateAddress } from '../src/webComponent/lastValueByAbsoluteStateAddress';
import { IAbsoluteStateAddress } from '../src/address/types';

describe('lastValueByAbsoluteStateAddress', () => {
  it('値を設定して取得できること', () => {
    const absAddress = {} as IAbsoluteStateAddress;
    const value = { name: 'Alice', age: 30 };

    setLastValueByAbsoluteStateAddress(absAddress, value);
    const result = getLastValueByAbsoluteStateAddress(absAddress);

    expect(result).toBe(value);
  });

  it('未登録のabsAddressに対してはundefinedを返すこと', () => {
    const absAddress = {} as IAbsoluteStateAddress;

    const result = getLastValueByAbsoluteStateAddress(absAddress);

    expect(result).toBeUndefined();
  });

  it('異なるabsAddressに対して独立した値を保持すること', () => {
    const absAddress1 = {} as IAbsoluteStateAddress;
    const absAddress2 = {} as IAbsoluteStateAddress;
    const value1 = 'value1';
    const value2 = 'value2';

    setLastValueByAbsoluteStateAddress(absAddress1, value1);
    setLastValueByAbsoluteStateAddress(absAddress2, value2);

    expect(getLastValueByAbsoluteStateAddress(absAddress1)).toBe(value1);
    expect(getLastValueByAbsoluteStateAddress(absAddress2)).toBe(value2);
  });

  it('同じabsAddressに対して値を上書きできること', () => {
    const absAddress = {} as IAbsoluteStateAddress;
    const value1 = 'value1';
    const value2 = 'value2';

    setLastValueByAbsoluteStateAddress(absAddress, value1);
    expect(getLastValueByAbsoluteStateAddress(absAddress)).toBe(value1);

    setLastValueByAbsoluteStateAddress(absAddress, value2);
    expect(getLastValueByAbsoluteStateAddress(absAddress)).toBe(value2);
  });
});

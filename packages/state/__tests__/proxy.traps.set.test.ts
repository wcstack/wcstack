import { describe, it, expect, vi, afterEach } from 'vitest';
import { set } from '../src/proxy/traps/set';
import { createListIndex } from '../src/list/createListIndex';

vi.mock('../src/proxy/methods/getListIndex', () => ({
  getListIndex: vi.fn()
}));

vi.mock('../src/proxy/methods/setByAddress', () => ({
  setByAddress: vi.fn()
}));

import { getListIndex } from '../src/proxy/methods/getListIndex';
import { setByAddress } from '../src/proxy/methods/setByAddress';

const getListIndexMock = vi.mocked(getListIndex);
const setByAddressMock = vi.mocked(setByAddress);

describe('proxy/traps/set', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('文字列プロパティは setByAddress を使って設定すること', () => {
    const listIndex = createListIndex(null, 0);
    getListIndexMock.mockReturnValueOnce(listIndex as any);
    setByAddressMock.mockReturnValueOnce(true);

    const handler = {} as any;
    const target = { user: { name: 'Alice' } };
    const receiver = { receiver: true };

    const result = set(target, 'user.name', 'Bob', receiver, handler);

    expect(getListIndexMock).toHaveBeenCalledTimes(1);
    expect(getListIndexMock).toHaveBeenCalledWith(target, expect.any(Object), receiver, handler);
    expect(setByAddressMock).toHaveBeenCalledTimes(1);
    const stateAddress = setByAddressMock.mock.calls[0][1] as any;
    expect(stateAddress.pathInfo.path).toBe('user.name');
    expect(result).toBe(true);
  });

  it('symbol プロパティは Reflect.set を使うこと', () => {
    const sym = Symbol('value');
    const target: any = {};

    const result = set(target, sym, 42, target, {} as any);

    expect(result).toBe(true);
    expect(target[sym]).toBe(42);
  });
});
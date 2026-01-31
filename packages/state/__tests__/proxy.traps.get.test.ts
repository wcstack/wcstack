import { describe, it, expect, vi, afterEach } from 'vitest';
import { get } from '../src/proxy/traps/get';
import { createListIndex } from '../src/list/createListIndex';
import { createStateAddress } from '../src/address/StateAddress';
import { getPathInfo } from '../src/address/PathInfo';

vi.mock('../src/proxy/methods/setLoopContext', () => ({
  setLoopContext: vi.fn()
}));

vi.mock('../src/proxy/methods/getByAddress', () => ({
  getByAddress: vi.fn()
}));

vi.mock('../src/proxy/methods/getListIndex', () => ({
  getListIndex: vi.fn()
}));

import { setLoopContext } from '../src/proxy/methods/setLoopContext';
import { getByAddress } from '../src/proxy/methods/getByAddress';
import { getListIndex } from '../src/proxy/methods/getListIndex';

const setLoopContextMock = vi.mocked(setLoopContext);
const getByAddressMock = vi.mocked(getByAddress);
const getListIndexMock = vi.mocked(getListIndex);

describe('proxy/traps/get', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('$1 で listIndex の値が取得できること', () => {
    const listIndex = createListIndex(null, 3);
    const handler = {
      lastAddressStack: createStateAddress(getPathInfo('items.*'), listIndex)
    } as any;

    const result = get({}, '$1', {}, handler);
    expect(result).toBe(3);
  });

  it('listIndex が無い場合は $1 でエラーになること', () => {
    const handler = { lastAddressStack: null } as any;
    expect(() => get({}, '$1', {}, handler)).toThrow('ListIndex not found: $1');
  });

  it('$$setLoopContext が setLoopContext を呼び出すこと', async () => {
    setLoopContextMock.mockImplementationOnce(async (_handler, _loopContext, callback) => {
      return callback();
    });
    const handler = {} as any;
    const loopContext = { name: 'loop' };

    const fn = get({}, '$$setLoopContext', {}, handler) as (loopContext: any) => Promise<any>;
    const result = await fn(loopContext);

    expect(setLoopContextMock).toHaveBeenCalledTimes(1);
    expect(setLoopContextMock).toHaveBeenCalledWith(handler, loopContext, expect.any(Function));
    expect(result).toBeUndefined();
  });

  it('$$getByAddress が getByAddress を呼び出すこと', () => {
    getByAddressMock.mockReturnValueOnce('value');
    const handler = {} as any;
    const target = { a: 1 };
    const receiver = { receiver: true };
    const address = createStateAddress(getPathInfo('a'), null);

    const fn = get(target, '$$getByAddress', receiver, handler) as (address: any) => any;
    const result = fn(address);

    expect(getByAddressMock).toHaveBeenCalledTimes(1);
    expect(getByAddressMock).toHaveBeenCalledWith(target, address, receiver, handler);
    expect(result).toBe('value');
  });

  it('通常の文字列プロパティは getListIndex と getByAddress を経由すること', () => {
    const listIndex = createListIndex(null, 0);
    getListIndexMock.mockReturnValueOnce(listIndex as any);
    getByAddressMock.mockReturnValueOnce('result');

    const handler = {} as any;
    const target = { user: { name: 'Alice' } };
    const receiver = { receiver: true };

    const result = get(target, 'user.name', receiver, handler);

    expect(getListIndexMock).toHaveBeenCalledTimes(1);
    expect(getListIndexMock).toHaveBeenCalledWith(target, expect.any(Object), receiver, handler);

    const stateAddress = getByAddressMock.mock.calls[0][1] as any;
    expect(stateAddress.pathInfo.path).toBe('user.name');
    expect(result).toBe('result');
  });

  it('symbol プロパティは Reflect.get を返すこと', () => {
    const sym = Symbol('value');
    const target = { [sym]: 42 } as any;

    const result = get(target, sym, target, {} as any);
    expect(result).toBe(42);
  });

  it('文字列・symbol 以外のプロパティは undefined を返すこと', () => {
    const result = get({}, 1, {}, {} as any);
    expect(result).toBeUndefined();
  });
});
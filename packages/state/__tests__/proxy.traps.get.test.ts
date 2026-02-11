import { describe, it, expect, vi, afterEach } from 'vitest';
import { get } from '../src/proxy/traps/get';
import { createListIndex } from '../src/list/createListIndex';
import { createStateAddress } from '../src/address/StateAddress';
import { getPathInfo } from '../src/address/PathInfo';
import { setLoopContextAsyncSymbol, setLoopContextSymbol, getByAddressSymbol } from '../src/proxy/symbols';

vi.mock('../src/proxy/methods/setLoopContext', () => ({
  setLoopContext: vi.fn(),
  setLoopContextAsync: vi.fn()
}));

vi.mock('../src/proxy/methods/getByAddress', () => ({
  getByAddress: vi.fn()
}));

vi.mock('../src/proxy/methods/getListIndex', () => ({
  getListIndex: vi.fn()
}));

vi.mock('../src/proxy/apis/getAll', () => ({
  getAll: vi.fn()
}));

vi.mock('../src/proxy/apis/postUpdate', () => ({
  postUpdate: vi.fn()
}));

vi.mock('../src/proxy/apis/resolve', () => ({
  resolve: vi.fn()
}));

vi.mock('../src/proxy/apis/trackDependency', () => ({
  trackDependency: vi.fn()
}));

import { setLoopContext, setLoopContextAsync } from '../src/proxy/methods/setLoopContext';
import { getByAddress } from '../src/proxy/methods/getByAddress';
import { getListIndex } from '../src/proxy/methods/getListIndex';
import { getAll } from '../src/proxy/apis/getAll';
import { postUpdate } from '../src/proxy/apis/postUpdate';
import { resolve } from '../src/proxy/apis/resolve';
import { trackDependency } from '../src/proxy/apis/trackDependency';

const setLoopContextMock = vi.mocked(setLoopContext);
const setLoopContextAsyncMock = vi.mocked(setLoopContextAsync);
const getByAddressMock = vi.mocked(getByAddress);
const getListIndexMock = vi.mocked(getListIndex);
const getAllMock = vi.mocked(getAll);
const postUpdateMock = vi.mocked(postUpdate);
const resolveMock = vi.mocked(resolve);
const trackDependencyMock = vi.mocked(trackDependency);

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

  it('addressStackLength が 0 の場合は $1 でエラーになること', () => {
    const handler = { addressStackLength: 0 } as any;
    expect(() => get({}, '$1', {}, handler)).toThrow(/No active state reference to get list index/);
  });

  it('listIndex が無い場合は $1 でエラーになること', () => {
    const handler = { addressStackLength: 1, lastAddressStack: null } as any;
    expect(() => get({}, '$1', {}, handler)).toThrow('ListIndex not found: $1');
  });

  it('listIndex は有るが index が無い場合は $1 でエラーになること', () => {
    const listIndex = { indexes: [] }; // index 0 ($1) が無い
    const handler = {
      addressStackLength: 1,
      lastAddressStack: { listIndex }
    } as any;
    expect(() => get({}, '$1', {}, handler)).toThrow('ListIndex not found: $1');
  });

  it('$$setLoopContextAsync が setLoopContextAsync を呼び出すこと', async () => {
    setLoopContextAsyncMock.mockImplementationOnce(async (_handler, _loopContext, callback) => {
      return callback();
    });
    const handler = {} as any;
    const loopContext = { name: 'loop' };

    const fn = get({}, setLoopContextAsyncSymbol, {}, handler) as (loopContext: any) => Promise<any>;
    const result = await fn(loopContext);

    expect(setLoopContextAsyncMock).toHaveBeenCalledTimes(1);
    expect(setLoopContextAsyncMock).toHaveBeenCalledWith(handler, loopContext, expect.any(Function));
    expect(result).toBeUndefined();
  });

  it('$$setLoopContext が setLoopContext を呼び出すこと', () => {
    setLoopContextMock.mockImplementationOnce((_handler, _loopContext, callback) => {
      return callback();
    });
    const handler = {} as any;
    const loopContext = { name: 'loop' };

    const fn = get({}, setLoopContextSymbol, {}, handler) as (loopContext: any) => any;
    const result = fn(loopContext);

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

    const fn = get(target, getByAddressSymbol, receiver, handler) as (address: any) => any;
    const result = fn(address);

    expect(getByAddressMock).toHaveBeenCalledTimes(1);
    expect(getByAddressMock).toHaveBeenCalledWith(target, address, receiver, handler);
    expect(result).toBe('value');
  });

  it('$getAll が getAll を呼び出すこと', () => {
    const innerFn = vi.fn().mockReturnValue(['a', 'b', 'c']);
    getAllMock.mockReturnValueOnce(innerFn);
    const handler = {} as any;
    const target = { items: ['a', 'b', 'c'] };
    const receiver = { receiver: true };

    const fn = get(target, '$getAll', receiver, handler) as (path: string, indexes?: number[]) => any[];
    const result = fn('items.*', [0, 1, 2]);

    expect(getAllMock).toHaveBeenCalledTimes(1);
    expect(getAllMock).toHaveBeenCalledWith(target, '$getAll', receiver, handler);
    expect(innerFn).toHaveBeenCalledWith('items.*', [0, 1, 2]);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('$getAll が indexes なしで呼び出せること', () => {
    const innerFn = vi.fn().mockReturnValue([1, 2]);
    getAllMock.mockReturnValueOnce(innerFn);
    const handler = {} as any;

    const fn = get({}, '$getAll', {}, handler) as (path: string) => any[];
    fn('items.*');

    expect(innerFn).toHaveBeenCalledWith('items.*', undefined);
  });

  it('$postUpdate が postUpdate を呼び出すこと', () => {
    const innerFn = vi.fn();
    postUpdateMock.mockReturnValueOnce(innerFn);
    const handler = {} as any;
    const target = {};
    const receiver = {};

    const fn = get(target, '$postUpdate', receiver, handler) as (path: string) => void;
    fn('count');

    expect(postUpdateMock).toHaveBeenCalledWith(target, '$postUpdate', receiver, handler);
    expect(innerFn).toHaveBeenCalledWith('count');
  });

  it('$resolve が resolve を呼び出すこと', () => {
    const innerFn = vi.fn().mockReturnValue('resolved');
    resolveMock.mockReturnValueOnce(innerFn);
    const handler = {} as any;
    const target = {};
    const receiver = {};

    const fn = get(target, '$resolve', receiver, handler) as (path: string, indexes: number[], value?: any) => any;
    const result = fn('items.*', [0], 'val');

    expect(resolveMock).toHaveBeenCalledWith(target, '$resolve', receiver, handler);
    expect(innerFn).toHaveBeenCalledWith('items.*', [0], 'val');
    expect(result).toBe('resolved');
  });

  it('$trackDependency が trackDependency を呼び出すこと', () => {
    const innerFn = vi.fn();
    trackDependencyMock.mockReturnValueOnce(innerFn);
    const handler = {} as any;
    const target = {};
    const receiver = {};

    const fn = get(target, '$trackDependency', receiver, handler) as (path: string) => void;
    fn('some.path');

    expect(trackDependencyMock).toHaveBeenCalledWith(target, '$trackDependency', receiver, handler);
    expect(innerFn).toHaveBeenCalledWith('some.path');
  });

  it('$stateElement が handler.stateElement を返すこと', () => {
    const stateElement = { name: 'my-state' };
    const handler = { stateElement } as any;
    
    const result = get({}, '$stateElement', {}, handler);
    expect(result).toBe(stateElement);
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
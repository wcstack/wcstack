import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolve } from '../src/proxy/apis/resolve';
import { createListIndex } from '../src/list/createListIndex';
import { setListIndexesByList } from '../src/list/listIndexesByList';
import { setStateElementByName } from '../src/stateElementByName';

vi.mock('../src/proxy/methods/getByAddress', () => ({
  getByAddress: vi.fn()
}));

vi.mock('../src/proxy/methods/setByAddress', () => ({
  setByAddress: vi.fn()
}));

import { getByAddress } from '../src/proxy/methods/getByAddress';
import { setByAddress } from '../src/proxy/methods/setByAddress';

const getByAddressMock = vi.mocked(getByAddress);
const setByAddressMock = vi.mocked(setByAddress);

function createStateElement(overrides?: Partial<any>) {
  return {
    name: 'default',
    listPaths: new Set<string>(),
    getterPaths: new Set<string>(),
    setterPaths: new Set<string>(),
    addDynamicDependency: vi.fn(),
    ...overrides,
  };
}

function createHandler(stateElement: any, overrides?: Partial<any>) {
  return {
    addressStackLength: 0,
    lastAddressStack: null,
    stateElement,
    pushAddress: vi.fn(),
    popAddress: vi.fn(),
    ...overrides,
  };
}

describe('resolve', () => {
  let mockStateElement: any;

  afterEach(() => {
    vi.clearAllMocks();
    setStateElementByName(document, 'default', null);
  });

  it('ワイルドカードなしのパスで値を取得できること', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = { name: 'Alice' };

    getByAddressMock.mockReturnValueOnce('Alice');

    const resolveFn = resolve(target, '$resolve', target, handler as any);
    const result = resolveFn('name', []);

    expect(getByAddressMock).toHaveBeenCalledTimes(1);
    expect(result).toBe('Alice');
  });

  it('ワイルドカードなしのパスで値を設定できること', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = { name: 'Alice' };

    const resolveFn = resolve(target, '$resolve', target, handler as any);
    resolveFn('name', [], 'Bob');

    expect(setByAddressMock).toHaveBeenCalledTimes(1);
    expect(setByAddressMock.mock.calls[0][2]).toBe('Bob');
  });

  it('ワイルドカード付きパスでインデックスを解決して値を取得できること', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};
    const list = ['a', 'b', 'c'];

    const listIndex0 = createListIndex(null, 0);
    const listIndex1 = createListIndex(null, 1);
    const listIndex2 = createListIndex(null, 2);
    setListIndexesByList(list, [listIndex0, listIndex1, listIndex2]);

    // getByAddress: 1回目はリスト取得、2回目は値取得
    getByAddressMock
      .mockReturnValueOnce(list)
      .mockReturnValueOnce('b');

    const resolveFn = resolve(target, '$resolve', target, handler as any);
    const result = resolveFn('items.*', [1]);

    expect(getByAddressMock).toHaveBeenCalledTimes(2);
    expect(result).toBe('b');
  });

  it('ワイルドカード付きパスで値を設定できること', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};
    const list = ['a', 'b', 'c'];

    const listIndex0 = createListIndex(null, 0);
    const listIndex1 = createListIndex(null, 1);
    const listIndex2 = createListIndex(null, 2);
    setListIndexesByList(list, [listIndex0, listIndex1, listIndex2]);

    getByAddressMock.mockReturnValueOnce(list);

    const resolveFn = resolve(target, '$resolve', target, handler as any);
    resolveFn('items.*', [2], 'x');

    expect(setByAddressMock).toHaveBeenCalledTimes(1);
    expect(setByAddressMock.mock.calls[0][2]).toBe('x');
  });

  it('indexes の長さが不足している場合はエラーになること', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    const resolveFn = resolve(target, '$resolve', target, handler as any);

    expect(() => resolveFn('items.*', [])).toThrow(/indexes length is insufficient/);
  });

  it('多重ワイルドカードでネストしたインデックスを解決できること', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    const outerList = [['a', 'b'], ['c', 'd']];
    const outerIndex0 = createListIndex(null, 0);
    const outerIndex1 = createListIndex(null, 1);
    setListIndexesByList(outerList, [outerIndex0, outerIndex1]);

    const innerList = ['c', 'd'];
    const innerIndex0 = createListIndex(outerIndex1, 0);
    const innerIndex1 = createListIndex(outerIndex1, 1);
    setListIndexesByList(innerList, [innerIndex0, innerIndex1]);

    // 1回目: 外側リスト取得, 2回目: 内側リスト取得, 3回目: 値取得
    getByAddressMock
      .mockReturnValueOnce(outerList)
      .mockReturnValueOnce(innerList)
      .mockReturnValueOnce('d');

    const resolveFn = resolve(target, '$resolve', target, handler as any);
    const result = resolveFn('categories.*.items.*', [1, 1]);

    expect(getByAddressMock).toHaveBeenCalledTimes(3);
    expect(result).toBe('d');
  });

  it('getterパスの場合は動的依存関係を登録すること', () => {
    mockStateElement = createStateElement();
    mockStateElement.getterPaths.add('computed');
    setStateElementByName(document, 'default', mockStateElement);

    const lastAddress = {
      pathInfo: { path: 'computed' },
      listIndex: null,
    };
    const handler = createHandler(mockStateElement, { addressStackLength: 1, lastAddressStack: lastAddress });
    const target = {};

    getByAddressMock.mockReturnValueOnce('value');

    const resolveFn = resolve(target, '$resolve', target, handler as any);
    resolveFn('name', []);

    expect(mockStateElement.addDynamicDependency).toHaveBeenCalledWith('name', 'computed');
  });

  it('addressStackLength>0でlastAddressStackがnullなら依存関係を登録しないこと', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement, { addressStackLength: 1, lastAddressStack: null });
    const target = {};

    getByAddressMock.mockReturnValueOnce('value');

    const resolveFn = resolve(target, '$resolve', target, handler as any);
    resolveFn('name', []);

    expect(mockStateElement.addDynamicDependency).not.toHaveBeenCalled();
  });

  it('addressStackLength>0でgetterPathsに含まれない場合は依存関係を登録しないこと', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);

    const lastAddress = {
      pathInfo: { path: 'other' },
      listIndex: null,
    };
    const handler = createHandler(mockStateElement, { addressStackLength: 1, lastAddressStack: lastAddress });
    const target = {};

    getByAddressMock.mockReturnValueOnce('value');

    const resolveFn = resolve(target, '$resolve', target, handler as any);
    resolveFn('name', []);

    expect(mockStateElement.addDynamicDependency).not.toHaveBeenCalled();
  });

  it('addressStackLength>0で同一パスの場合は依存関係を登録しないこと', () => {
    mockStateElement = createStateElement();
    mockStateElement.getterPaths.add('name');
    setStateElementByName(document, 'default', mockStateElement);

    const lastAddress = {
      pathInfo: { path: 'name' },
      listIndex: null,
    };
    const handler = createHandler(mockStateElement, { addressStackLength: 1, lastAddressStack: lastAddress });
    const target = {};

    getByAddressMock.mockReturnValueOnce('value');

    const resolveFn = resolve(target, '$resolve', target, handler as any);
    resolveFn('name', []);

    expect(mockStateElement.addDynamicDependency).not.toHaveBeenCalled();
  });

  it('ワイルドカードパスで listIndexes が null の場合はエラーになること', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};

    // getByAddress がリストではない値を返す（listIndexes が null になる）
    getByAddressMock.mockReturnValueOnce('not-an-array');

    const resolveFn = resolve(target, '$resolve', target, handler as any);

    expect(() => resolveFn('items.*', [0])).toThrow(/ListIndexes not found/);
  });

  it('ワイルドカードパスで指定インデックスが存在しない場合はエラーになること', () => {
    mockStateElement = createStateElement();
    setStateElementByName(document, 'default', mockStateElement);
    const handler = createHandler(mockStateElement);
    const target = {};
    const list = ['a'];

    const listIndex0 = createListIndex(null, 0);
    setListIndexesByList(list, [listIndex0]);

    getByAddressMock.mockReturnValueOnce(list);

    const resolveFn = resolve(target, '$resolve', target, handler as any);

    expect(() => resolveFn('items.*', [99])).toThrow(/ListIndex not found/);
  });

  it('lastAddressStackのパスと同一パスの場合は依存関係を登録しないこと', () => {
    mockStateElement = createStateElement();
    mockStateElement.getterPaths.add('name');
    setStateElementByName(document, 'default', mockStateElement);

    const lastAddress = {
      pathInfo: { path: 'name' },
      listIndex: null,
    };
    const handler = createHandler(mockStateElement, { addressStackLength: 1, lastAddressStack: lastAddress });
    const target = {};

    getByAddressMock.mockReturnValueOnce('value');

    const resolveFn = resolve(target, '$resolve', target, handler as any);
    resolveFn('name', []);

    expect(mockStateElement.addDynamicDependency).not.toHaveBeenCalled();
  });
});

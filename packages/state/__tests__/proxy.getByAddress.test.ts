import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getByAddress } from '../src/proxy/methods/getByAddress';
import { createStateAddress } from '../src/address/StateAddress';
import { getPathInfo } from '../src/address/PathInfo';
import { createListIndex } from '../src/list/createListIndex';
import { setStateElementByName } from '../src/stateElementByName';
import { setCacheEntryByAbsoluteStateAddress } from '../src/cache/cacheEntryByAbsoluteStateAddress';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';

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
    addressStackIndex: -1,
    lastAddressStack: null,
    stateElement,
    pushAddress: vi.fn(),
    popAddress: vi.fn(),
    ...overrides,
  };
}

describe('getByAddress', () => {
  let mockStateElement: any;

  beforeEach(() => {
    mockStateElement = createStateElement();
    setStateElementByName('default', mockStateElement);
  });

  afterEach(() => {
    setStateElementByName('default', null);
  });

  it('getterPathsに含まれる場合はpush/popしつつgetter経由で取得すること', () => {
    const target = {
      _total: 3,
      get total() {
        return this._total;
      }
    };
    const address = createStateAddress(getPathInfo('total'), null);
    mockStateElement.getterPaths.add('total');
    const handler = createHandler(mockStateElement);

    const value = getByAddress(target, address, target, handler as any);
    expect(value).toBe(3);
    expect(handler.pushAddress).toHaveBeenCalledWith(address);
    expect(handler.popAddress).toHaveBeenCalled();

    // クリーンアップ
    mockStateElement.getterPaths.delete('total');
  });

  it('通常のプロパティは直接取得できること', () => {
    const target = { count: 2 };
    const address = createStateAddress(getPathInfo('count'), null);
    const handler = createHandler(mockStateElement);

    const value = getByAddress(target, address, target, handler as any);
    expect(value).toBe(2);
  });

  it('ワイルドカードパスをlistIndexで解決できること', () => {
    const target = { users: [{ name: 'Ann' }] };
    const listIndex = createListIndex(null, 0);
    const address = createStateAddress(getPathInfo('users.*.name'), listIndex);
    const handler = createHandler(mockStateElement);

    const value = getByAddress(target, address, target, handler as any);
    expect(value).toBe('Ann');
  });

  it('ワイルドカードでlistIndexが無い場合はエラーになること', () => {
    const target = { users: [{ name: 'Ann' }] };
    const address = createStateAddress(getPathInfo('users.*'), null);
    const handler = createHandler(mockStateElement);

    expect(() => getByAddress(target, address, target, handler as any)).toThrow(/listIndex.*undefined/);
  });

  it('親が存在しないパスでtargetに無い場合はエラーになること', () => {
    const target = {};
    const address = createStateAddress(getPathInfo('missing'), null);
    const handler = createHandler(mockStateElement);

    expect(() => getByAddress(target, address, target, handler as any)).toThrow(/address.parentAddress is undefined/);
  });

  it('キャッシュがある場合はキャッシュを返すこと', () => {
    const target = { total: 10 };
    const address = createStateAddress(getPathInfo('total'), null);
    mockStateElement.getterPaths.add('total');
    const absAddress = createAbsoluteStateAddress(mockStateElement.name, address);
    setCacheEntryByAbsoluteStateAddress(absAddress, { value: 99 });
    const handler = createHandler(mockStateElement);

    const value = getByAddress(target, address, target, handler as any);
    expect(value).toBe(99);

    // クリーンアップ
    setCacheEntryByAbsoluteStateAddress(absAddress, null);
    mockStateElement.getterPaths.delete('total');
  });

  it('キャッシュが無い場合は取得してキャッシュに保存すること', () => {
    const target = { total: 10 };
    const address = createStateAddress(getPathInfo('total'), null);
    mockStateElement.getterPaths.add('total');
    const absAddress = createAbsoluteStateAddress(mockStateElement.name, address);
    // キャッシュをクリア
    setCacheEntryByAbsoluteStateAddress(absAddress, null);
    const handler = createHandler(mockStateElement);

    const value = getByAddress(target, address, target, handler as any);
    expect(value).toBe(10);

    // クリーンアップ
    setCacheEntryByAbsoluteStateAddress(absAddress, null);
    mockStateElement.getterPaths.delete('total');
  });

  it('ワイルドカードのキャッシュが無い場合は取得してキャッシュに保存すること', () => {
    const target = { users: [{ name: 'Ann' }] };
    const listIndex = createListIndex(null, 0);
    const address = createStateAddress(getPathInfo('users.*.name'), listIndex);
    const absAddress = createAbsoluteStateAddress(mockStateElement.name, address);
    // キャッシュをクリア
    setCacheEntryByAbsoluteStateAddress(absAddress, null);
    const handler = createHandler(mockStateElement);

    const value = getByAddress(target, address, target, handler as any);
    expect(value).toBe('Ann');

    // クリーンアップ
    setCacheEntryByAbsoluteStateAddress(absAddress, null);
  });

});

import { describe, it, expect, vi } from 'vitest';
import { getByAddress } from '../src/proxy/methods/getByAddress';
import { createStateAddress } from '../src/address/StateAddress';
import { getPathInfo } from '../src/address/PathInfo';
import { createListIndex } from '../src/list/createListIndex';
import { getListIndexesByList, setListIndexesByList } from '../src/list/listIndexesByList';

function createStateElement(overrides?: Partial<any>) {
  return {
    listPaths: new Set<string>(),
    getterPaths: new Set<string>(),
    setterPaths: new Set<string>(),
    cache: new Map(),
    mightChangeByPath: new Map(),
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
    updater: { versionInfo: { version: 1, revision: 0 } },
    ...overrides,
  };
}

describe('getByAddress', () => {
  it('getterPathsに含まれる場合はpush/popしつつgetter経由で取得すること', () => {
    const target = {
      _total: 3,
      get total() {
        return this._total;
      }
    };
    const address = createStateAddress(getPathInfo('total'), null);
    const stateElement = createStateElement({ getterPaths: new Set(['total']) });
    const handler = createHandler(stateElement);

    const value = getByAddress(target, address, target, handler as any);
    expect(value).toBe(3);
    expect(handler.pushAddress).toHaveBeenCalledWith(address);
    expect(handler.popAddress).toHaveBeenCalled();
  });

  it('通常のプロパティは直接取得できること', () => {
    const target = { count: 2 };
    const address = createStateAddress(getPathInfo('count'), null);
    const stateElement = createStateElement();
    const handler = createHandler(stateElement);

    const value = getByAddress(target, address, target, handler as any);
    expect(value).toBe(2);
  });

  it('ワイルドカードパスをlistIndexで解決できること', () => {
    const target = { users: [{ name: 'Ann' }] };
    const listIndex = createListIndex(null, 0);
    const address = createStateAddress(getPathInfo('users.*.name'), listIndex);
    const stateElement = createStateElement();
    const handler = createHandler(stateElement);

    const value = getByAddress(target, address, target, handler as any);
    expect(value).toBe('Ann');
  });

  it('ワイルドカードでlistIndexが無い場合はエラーになること', () => {
    const target = { users: [{ name: 'Ann' }] };
    const address = createStateAddress(getPathInfo('users.*'), null);
    const stateElement = createStateElement();
    const handler = createHandler(stateElement);

    expect(() => getByAddress(target, address, target, handler as any)).toThrow(/listIndex.*undefined/);
  });

  it('親が存在しないパスでtargetに無い場合はエラーになること', () => {
    const target = {};
    const address = createStateAddress(getPathInfo('missing'), null);
    const stateElement = createStateElement();
    const handler = createHandler(stateElement);

    expect(() => getByAddress(target, address, target, handler as any)).toThrow(/address.parentAddress is undefined/);
  });

  it('キャッシュがあり更新情報が無い場合はキャッシュを返すこと', () => {
    const target = { total: 10 };
    const address = createStateAddress(getPathInfo('total'), null);
    const stateElement = createStateElement({ getterPaths: new Set(['total']) });
    stateElement.cache.set(address, { value: 99, versionInfo: { version: 1, revision: 0 } });
    const handler = createHandler(stateElement, { updater: { versionInfo: { version: 1, revision: 0 } } });

    const value = getByAddress(target, address, target, handler as any);
    expect(value).toBe(99);
  });

  it('キャッシュのversionがhandlerより新しい場合はキャッシュを返すこと', () => {
    const target = { total: 10 };
    const address = createStateAddress(getPathInfo('total'), null);
    const stateElement = createStateElement({ getterPaths: new Set(['total']) });
    stateElement.cache.set(address, { value: 55, versionInfo: { version: 5, revision: 0 } });
    stateElement.mightChangeByPath.set('total', { version: 1, revision: 0 });
    const handler = createHandler(stateElement, { updater: { versionInfo: { version: 3, revision: 0 } } });

    const value = getByAddress(target, address, target, handler as any);
    expect(value).toBe(55);
  });

  it('更新情報が古い場合は再取得してキャッシュ更新すること', () => {
    const target = { items: [1, 2] };
    const address = createStateAddress(getPathInfo('items'), null);
    const stateElement = createStateElement({ listPaths: new Set(['items']) });
    stateElement.cache.set(address, { value: [0], versionInfo: { version: 1, revision: 0 } });
    stateElement.mightChangeByPath.set('items', { version: 2, revision: 0 });
    const handler = createHandler(stateElement, { updater: { versionInfo: { version: 2, revision: 0 } } });

    const value = getByAddress(target, address, target, handler as any);
    expect(value).toEqual([1, 2]);
    expect(getListIndexesByList(value)).not.toBeNull();

    setListIndexesByList(value, null);
  });

  it('更新が無い場合はキャッシュを返すこと', () => {
    const target = { total: 10 };
    const address = createStateAddress(getPathInfo('total'), null);
    const stateElement = createStateElement({ getterPaths: new Set(['total']) });
    stateElement.cache.set(address, { value: 77, versionInfo: { version: 2, revision: 1 } });
    stateElement.mightChangeByPath.set('total', { version: 2, revision: 1 });
    const handler = createHandler(stateElement, { updater: { versionInfo: { version: 3, revision: 0 } } });

    const value = getByAddress(target, address, target, handler as any);
    expect(value).toBe(77);
  });
});

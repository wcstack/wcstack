import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStateProxy } from '../src/proxy/Proxy';
import { createListIndex } from '../src/list/createListIndex';
import { getListIndexesByList, setListIndexesByList } from '../src/list/listIndexesByList';
import type { IBindingInfo } from '../src/types';

vi.mock('../src/apply/applyChange', () => ({
  applyChange: vi.fn()
}));

import { applyChange } from '../src/apply/applyChange';

const applyChangeMock = vi.mocked(applyChange);

describe('proxy/Proxy', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('存在しないプロパティはundefinedを返すこと', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const proxy = createStateProxy({}, new Map(), new Set());
    expect((proxy as any).unknown).toBeUndefined();
    warnSpy.mockRestore();
  });

  it('ネストしたパスを取得できること', () => {
    const proxy = createStateProxy({ user: { name: 'Alice' } }, new Map(), new Set());
    expect((proxy as any)['user.name']).toBe('Alice');
  });

  it('$stackでワイルドカードパスを解決できること', () => {
    const state = { users: [{ name: 'Bob' }, { name: 'Carol' }] };
    const proxy = createStateProxy(state, new Map(), new Set());
    const listIndex = createListIndex(null, 1);

    const result = (proxy as any).$stack(listIndex, () => (proxy as any)['users.*.name']);
    expect(result).toBe('Carol');
  });

  it('listPathsに含まれる配列はget時にlistIndexesが設定されること', () => {
    const list = [1, 2, 3];
    const listPaths = new Set<string>(['items']);
    const proxy = createStateProxy({ items: list }, new Map(), listPaths);

    expect(getListIndexesByList(list)).toBeNull();
    const value = (proxy as any).items;
    expect(value).toBe(list);
    expect(getListIndexesByList(list)).not.toBeNull();

    setListIndexesByList(list, null);
  });

  it('listPathsに含まれる配列はset時にlistIndexesが設定されること', () => {
    const listPaths = new Set<string>(['items']);
    const proxy = createStateProxy({ items: [] }, new Map(), listPaths);

    const list = [10, 20];
    (proxy as any).items = list;

    expect(getListIndexesByList(list)).not.toBeNull();
    setListIndexesByList(list, null);
  });

  it('listPathsのget時にparentListIndexが引き継がれること', () => {
    const list = [1, 2];
    const listPaths = new Set<string>(['items']);
    const proxy = createStateProxy({ items: list }, new Map(), listPaths);
    const parentIndex = createListIndex(null, 5);

    const value = (proxy as any).$stack(parentIndex, () => (proxy as any).items);
    expect(value).toBe(list);

    const listIndexes = getListIndexesByList(list);
    expect(listIndexes).not.toBeNull();
    expect(listIndexes?.[0].parentListIndex).toBe(parentIndex);

    setListIndexesByList(list, null);
  });

  it('setでバインディングがあればapplyChangeが呼ばれること', () => {
    const bindingInfo = {
      propName: 'value',
      propSegments: ['value'],
      propModifiers: [],
      statePathName: 'count',
      statePathInfo: null,
      stateName: 'default',
      filterTexts: [],
      bindingType: 'prop',
      uuid: null,
      node: document.createElement('input'),
      placeHolderNode: document.createElement('input')
    } as IBindingInfo;

    const bindingMap = new Map<string, IBindingInfo[]>([['count', [bindingInfo]]]);
    const proxy = createStateProxy({ count: 0 }, bindingMap, new Set());

    (proxy as any).count = 2;
    expect(applyChangeMock).toHaveBeenCalledTimes(1);
    expect(applyChangeMock).toHaveBeenCalledWith(bindingInfo, 2);
  });
});

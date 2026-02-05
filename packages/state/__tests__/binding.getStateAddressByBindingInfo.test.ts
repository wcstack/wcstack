import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStateAddressByBindingInfo, clearStateAddressByBindingInfo } from '../src/binding/getStateAddressByBindingInfo';
import { getPathInfo } from '../src/address/PathInfo';
import { createListIndex } from '../src/list/createListIndex';
import type { IBindingInfo } from '../src/types';

vi.mock('../src/list/loopContextByNode', () => ({
  getLoopContextByNode: vi.fn()
}));

import { getLoopContextByNode } from '../src/list/loopContextByNode';

const getLoopContextByNodeMock = vi.mocked(getLoopContextByNode);

function createBindingInfo(overrides: Partial<IBindingInfo> = {}): IBindingInfo {
  const node = document.createTextNode('');
  return {
    propName: 'text',
    propSegments: [],
    propModifiers: [],
    statePathName: 'items',
    statePathInfo: getPathInfo('items'),
    stateName: 'default',
    filters: [],
    bindingType: 'text',
    node,
    replaceNode: node,
    ...overrides,
  } as IBindingInfo;
}

describe('getStateAddressByBindingInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLoopContextByNodeMock.mockReturnValue(null as any);
  });

  it('statePathInfoがnullならエラーになること', () => {
    const bindingInfo = createBindingInfo({ statePathInfo: null });
    expect(() => getStateAddressByBindingInfo(bindingInfo))
      .toThrow(/State path info is null/);
  });

  it('ワイルドカードでloopContextがnullならエラーになること', () => {
    const bindingInfo = createBindingInfo({
      statePathName: 'items.*',
      statePathInfo: getPathInfo('items.*')
    });
    expect(() => getStateAddressByBindingInfo(bindingInfo))
      .toThrow(/list index is null/);
  });

  it('ワイルドカードでloopContextがあればlistIndexを使って解決できること', () => {
    const listIndex = createListIndex(null, 0);
    getLoopContextByNodeMock.mockReturnValue({
      listIndex,
      elementPathInfo: getPathInfo('items.*')
    } as any);

    const bindingInfo = createBindingInfo({
      statePathName: 'items.*',
      statePathInfo: getPathInfo('items.*')
    });

    const address = getStateAddressByBindingInfo(bindingInfo);
    expect(address.listIndex).toBe(listIndex);
  });

  it('ワイルドカードなしはlistIndexがnullになること', () => {
    const bindingInfo = createBindingInfo({
      statePathName: 'items',
      statePathInfo: getPathInfo('items')
    });

    const address = getStateAddressByBindingInfo(bindingInfo);
    expect(address.listIndex).toBeNull();
  });

  it('キャッシュされたアドレスを返すこと', () => {
    const bindingInfo = createBindingInfo({
      statePathName: 'items',
      statePathInfo: getPathInfo('items')
    });

    const address1 = getStateAddressByBindingInfo(bindingInfo);
    const address2 = getStateAddressByBindingInfo(bindingInfo);
    expect(address1).toBe(address2);
  });
});

describe('clearStateAddressByBindingInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLoopContextByNodeMock.mockReturnValue(null as any);
  });

  it('キャッシュをクリアするとアドレスが再計算されること', () => {
    const listIndex1 = createListIndex(null, 0);
    const listIndex2 = createListIndex(null, 5);

    const bindingInfo = createBindingInfo({
      statePathName: 'items.*',
      statePathInfo: getPathInfo('items.*')
    });

    // 最初のloopContextでアドレスを取得
    getLoopContextByNodeMock.mockReturnValue({
      listIndex: listIndex1,
      elementPathInfo: getPathInfo('items.*')
    } as any);
    const address1 = getStateAddressByBindingInfo(bindingInfo);
    expect(address1.listIndex).toBe(listIndex1);

    // キャッシュをクリアせずにloopContextを変更
    getLoopContextByNodeMock.mockReturnValue({
      listIndex: listIndex2,
      elementPathInfo: getPathInfo('items.*')
    } as any);
    const addressCached = getStateAddressByBindingInfo(bindingInfo);
    // キャッシュから古いアドレスが返される
    expect(addressCached.listIndex).toBe(listIndex1);

    // キャッシュをクリアしてから取得
    clearStateAddressByBindingInfo(bindingInfo);
    const address2 = getStateAddressByBindingInfo(bindingInfo);
    // 新しいloopContextに基づいたアドレスが返される
    expect(address2.listIndex).toBe(listIndex2);
  });

  it('キャッシュが存在しない場合でもエラーにならないこと', () => {
    const bindingInfo = createBindingInfo({
      statePathName: 'items',
      statePathInfo: getPathInfo('items')
    });

    // 何も登録されていない状態でクリアしてもエラーにならない
    expect(() => clearStateAddressByBindingInfo(bindingInfo)).not.toThrow();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStateAddressByBindingInfo } from '../src/binding/getStateAddressByBindingInfo';
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
      .toThrow(/loop context is null/);
  });

  it('ワイルドカードでloopContextがあればlistIndexを使って解決できること', () => {
    const listIndex = createListIndex(null, 0);
    getLoopContextByNodeMock.mockReturnValue({ listIndex } as any);

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
});

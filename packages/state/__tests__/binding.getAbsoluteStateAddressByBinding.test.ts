import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/apply/rootNodeByFragment', () => ({
  getRootNodeByFragment: vi.fn()
}));
vi.mock('../src/list/getListIndexByBindingInfo', () => ({
  getListIndexByBindingInfo: vi.fn()
}));
vi.mock('../src/stateElementByName', () => ({
  getStateElementByName: vi.fn()
}));
vi.mock('../src/address/AbsolutePathInfo', () => ({
  getAbsolutePathInfo: vi.fn()
}));
vi.mock('../src/address/AbsoluteStateAddress', () => ({
  createAbsoluteStateAddress: vi.fn()
}));

import {
  getAbsoluteStateAddressByBinding,
  clearAbsoluteStateAddressByBinding
} from '../src/binding/getAbsoluteStateAddressByBinding';
import { getRootNodeByFragment } from '../src/apply/rootNodeByFragment';
import { getListIndexByBindingInfo } from '../src/list/getListIndexByBindingInfo';
import { getStateElementByName } from '../src/stateElementByName';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/binding/types';

const getRootNodeByFragmentMock = vi.mocked(getRootNodeByFragment);
const getListIndexByBindingInfoMock = vi.mocked(getListIndexByBindingInfo);
const getStateElementByNameMock = vi.mocked(getStateElementByName);
const getAbsolutePathInfoMock = vi.mocked(getAbsolutePathInfo);
const createAbsoluteStateAddressMock = vi.mocked(createAbsoluteStateAddress);

function createBinding(overrides: Partial<IBindingInfo> = {}): IBindingInfo {
  const node = document.createElement('div');
  document.body.appendChild(node);
  const pathInfo = getPathInfo('value');
  return {
    propName: 'textContent',
    propSegments: ['textContent'],
    propModifiers: [],
    statePathName: 'value',
    statePathInfo: pathInfo,
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'prop',
    uuid: null,
    node,
    replaceNode: node,
    ...overrides,
  } as IBindingInfo;
}

describe('getAbsoluteStateAddressByBinding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('接続済みノードで正常にアドレスを返すこと', () => {
    const binding = createBinding();
    const fakeStateElement = { name: 'default' } as any;
    const fakeAbsPathInfo = {} as any;
    const fakeAbsAddress = {} as any;

    getListIndexByBindingInfoMock.mockReturnValue(null);
    getStateElementByNameMock.mockReturnValue(fakeStateElement);
    getAbsolutePathInfoMock.mockReturnValue(fakeAbsPathInfo);
    createAbsoluteStateAddressMock.mockReturnValue(fakeAbsAddress);

    const result = getAbsoluteStateAddressByBinding(binding);

    expect(result).toBe(fakeAbsAddress);
    expect(getStateElementByNameMock).toHaveBeenCalledWith(document, 'default');
    expect(getAbsolutePathInfoMock).toHaveBeenCalledWith(fakeStateElement, binding.statePathInfo);

    clearAbsoluteStateAddressByBinding(binding);
  });

  it('2回目の呼び出しではキャッシュが返されること', () => {
    const binding = createBinding();
    const fakeAbsAddress = { cached: true } as any;

    getListIndexByBindingInfoMock.mockReturnValue(null);
    getStateElementByNameMock.mockReturnValue({ name: 'default' } as any);
    getAbsolutePathInfoMock.mockReturnValue({} as any);
    createAbsoluteStateAddressMock.mockReturnValue(fakeAbsAddress);

    const result1 = getAbsoluteStateAddressByBinding(binding);
    const result2 = getAbsoluteStateAddressByBinding(binding);

    expect(result1).toBe(fakeAbsAddress);
    expect(result2).toBe(fakeAbsAddress);
    expect(createAbsoluteStateAddressMock).toHaveBeenCalledTimes(1);

    clearAbsoluteStateAddressByBinding(binding);
  });

  it('clearAbsoluteStateAddressByBindingでキャッシュがクリアされること', () => {
    const binding = createBinding();
    const fakeAbsAddress1 = { first: true } as any;
    const fakeAbsAddress2 = { second: true } as any;

    getListIndexByBindingInfoMock.mockReturnValue(null);
    getStateElementByNameMock.mockReturnValue({ name: 'default' } as any);
    getAbsolutePathInfoMock.mockReturnValue({} as any);
    createAbsoluteStateAddressMock
      .mockReturnValueOnce(fakeAbsAddress1)
      .mockReturnValueOnce(fakeAbsAddress2);

    const result1 = getAbsoluteStateAddressByBinding(binding);
    expect(result1).toBe(fakeAbsAddress1);

    clearAbsoluteStateAddressByBinding(binding);

    const result2 = getAbsoluteStateAddressByBinding(binding);
    expect(result2).toBe(fakeAbsAddress2);
    expect(createAbsoluteStateAddressMock).toHaveBeenCalledTimes(2);

    clearAbsoluteStateAddressByBinding(binding);
  });

  it('切断されたノードでgetRootNodeByFragmentがnullの場合はエラーになること', () => {
    const node = document.createElement('span');
    // document.bodyに追加しない → isConnected=false
    const binding = createBinding({ node, replaceNode: node });

    getRootNodeByFragmentMock.mockReturnValue(null);

    expect(() => getAbsoluteStateAddressByBinding(binding))
      .toThrow(/Cannot get absolute state address for disconnected binding/);
  });

  it('切断されたノードでgetRootNodeByFragmentが解決できる場合は正常に処理されること', () => {
    const node = document.createElement('span');
    // document.bodyに追加しない → isConnected=false
    const binding = createBinding({ node, replaceNode: node });
    const fakeStateElement = { name: 'default' } as any;
    const fakeAbsAddress = {} as any;

    getRootNodeByFragmentMock.mockReturnValue(document);
    getListIndexByBindingInfoMock.mockReturnValue(null);
    getStateElementByNameMock.mockReturnValue(fakeStateElement);
    getAbsolutePathInfoMock.mockReturnValue({} as any);
    createAbsoluteStateAddressMock.mockReturnValue(fakeAbsAddress);

    const result = getAbsoluteStateAddressByBinding(binding);

    expect(result).toBe(fakeAbsAddress);
    expect(getRootNodeByFragmentMock).toHaveBeenCalled();
    expect(getStateElementByNameMock).toHaveBeenCalledWith(document, 'default');

    clearAbsoluteStateAddressByBinding(binding);
  });

  it('stateElementが見つからない場合はエラーになること', () => {
    const binding = createBinding();

    getListIndexByBindingInfoMock.mockReturnValue(null);
    getStateElementByNameMock.mockReturnValue(null);

    expect(() => getAbsoluteStateAddressByBinding(binding))
      .toThrow(/State element with name "default" not found for binding/);
  });
});

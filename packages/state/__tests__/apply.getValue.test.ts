import { describe, it, expect, vi } from 'vitest';
import { getValue } from '../src/apply/getValue';
import { getPathInfo } from '../src/address/PathInfo';
import { createListIndex } from '../src/list/createListIndex';
import { setLoopContextByNode } from '../src/list/loopContextByNode';
import { createStateAddress } from '../src/address/StateAddress';
import { IBindingInfo } from '../src/binding/types';
import { getByAddressSymbol } from '../src/proxy/symbols';

function createMockBindingInfo(path: string, node: Node): IBindingInfo {
  return {
    propName: 'textContent',
    propSegments: ['textContent'],
    propModifiers: [],
    statePathName: path,
    statePathInfo: getPathInfo(path),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    node,
    replaceNode: node,
    bindingType: 'text',
  };
}

describe('getValue', () => {
  it('通常のパスは state[getByAddressSymbol] を呼び出すこと', () => {
    const node = document.createElement('span');
    const binding = createMockBindingInfo('user.name', node);
    const state = {
      [getByAddressSymbol]: vi.fn().mockReturnValue('Alice'),
    } as any;

    const result = getValue(state, binding);
    expect(result).toBe('Alice');
    expect(state[getByAddressSymbol]).toHaveBeenCalledTimes(1);
  });

  it('$1 のインデックスパスは loopContext から値を取得すること', () => {
    const node = document.createElement('span');
    const parentNode = document.createElement('div');
    parentNode.appendChild(node);

    const listIndex = createListIndex(null, 7);
    setLoopContextByNode(parentNode, createStateAddress(getPathInfo('items.*'), listIndex) as any);

    const binding = createMockBindingInfo('$1', node);
    const state = {
      [getByAddressSymbol]: vi.fn(),
    } as any;

    const result = getValue(state, binding);
    expect(result).toBe(7);
    expect(state[getByAddressSymbol]).not.toHaveBeenCalled();

    // クリーンアップ
    setLoopContextByNode(parentNode, null);
  });

  it('$2 のインデックスパスはネストされた loopContext から値を取得すること', () => {
    const node = document.createElement('span');

    const parentListIndex = createListIndex(null, 1);
    const childListIndex = createListIndex(parentListIndex, 4);
    setLoopContextByNode(node, createStateAddress(getPathInfo('categories.*.items.*'), childListIndex) as any);

    const binding = createMockBindingInfo('$2', node);
    const state = {
      [getByAddressSymbol]: vi.fn(),
    } as any;

    const result = getValue(state, binding);
    expect(result).toBe(4);
    expect(state[getByAddressSymbol]).not.toHaveBeenCalled();

    // クリーンアップ
    setLoopContextByNode(node, null);
  });

  it('$1 で loopContext が見つからない場合はエラーになること', () => {
    const node = document.createElement('span');
    const binding = createMockBindingInfo('$1', node);
    const state = {
      [getByAddressSymbol]: vi.fn(),
    } as any;

    expect(() => getValue(state, binding)).toThrow(/ListIndex not found for binding: \$1/);
  });
});

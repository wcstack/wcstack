import { describe, it, expect } from 'vitest';
import { getListIndexByBindingInfo } from '../src/list/getListIndexByBindingInfo';
import { setLoopContextByNode } from '../src/list/loopContextByNode';
import { createListIndex } from '../src/list/createListIndex';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';
import type { ILoopContext } from '../src/list/types';

function createBindingInfo(node: Node, overrides?: Partial<IBindingInfo>): IBindingInfo {
  return {
    propName: 'value',
    propSegments: ['value'],
    propModifiers: [],
    statePathName: 'users.*.name',
    statePathInfo: getPathInfo('users.*.name'),
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

describe('getListIndexByBindingInfo', () => {

  it('loopContextがない場合はnullを返すこと', () => {
    const node = document.createElement('div');
    const bindingInfo = createBindingInfo(node);
    expect(getListIndexByBindingInfo(bindingInfo)).toBeNull();
  });

  it('一致するワイルドカードがあればlistIndexを返すこと', () => {
    const node = document.createElement('div');
    const root = createListIndex(null, 0);
    const child = createListIndex(root, 1);
    const loopContext: ILoopContext = {
      elementPathInfo: getPathInfo('users.*.orders.*'),
      listIndex: child,
    };
    setLoopContextByNode(node, loopContext);

    const bindingInfo = createBindingInfo(node, {
      statePathInfo: getPathInfo('users.*.orders.*.id'),
    });

    const listIndex = getListIndexByBindingInfo(bindingInfo);
    expect(listIndex).toBe(child);

    // cached result
    expect(getListIndexByBindingInfo(bindingInfo)).toBe(child);
  });

  it('一致するワイルドカードがない場合はnullを返すこと', () => {
    const node = document.createElement('div');
    const loopContext: ILoopContext = {
      elementPathInfo: getPathInfo('users.*'),
      listIndex: createListIndex(null, 0),
    };
    setLoopContextByNode(node, loopContext);

    const bindingInfo = createBindingInfo(node, {
      statePathInfo: getPathInfo('products.*.id'),
    });

    expect(getListIndexByBindingInfo(bindingInfo)).toBeNull();
    // cached null
    expect(getListIndexByBindingInfo(bindingInfo)).toBeNull();
  });

  it('同じloopContextでも別のbindingInfoは再評価されること', () => {
    const node = document.createElement('div');
    const loopContext: ILoopContext = {
      elementPathInfo: getPathInfo('users.*'),
      listIndex: createListIndex(null, 0),
    };
    setLoopContextByNode(node, loopContext);

    const bindingInfo1 = createBindingInfo(node, {
      statePathInfo: getPathInfo('users.*.name'),
    });
    const bindingInfo2 = createBindingInfo(node, {
      statePathInfo: getPathInfo('users.*.age'),
    });

    const first = getListIndexByBindingInfo(bindingInfo1);
    const second = getListIndexByBindingInfo(bindingInfo2);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
  });

});

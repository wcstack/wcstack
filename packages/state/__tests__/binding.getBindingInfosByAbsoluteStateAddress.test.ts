import { describe, it, expect } from 'vitest';
import {
  getBindingInfosByAbsoluteStateAddress,
  addBindingInfoByAbsoluteStateAddress,
  removeBindingInfoByAbsoluteStateAddress,
  clearBindingInfosByAbsoluteStateAddress,
} from '../src/binding/getBindingInfosByAbsoluteStateAddress';
import type { IAbsoluteStateAddress } from '../src/address/types';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';

const createAbsoluteAddress = (path = 'count'): IAbsoluteStateAddress => ({
  stateName: 'default',
  address: { pathInfo: { path } } as any,
});

const createBindingInfo = (id: string): IBindingInfo => ({
  propName: 'text',
  propSegments: [],
  propModifiers: [],
  statePathName: 'count',
  statePathInfo: getPathInfo('count'),
  stateName: 'default',
  outFilters: [],
  inFilters: [],
  bindingType: 'text',
  uuid: null,
  node: document.createTextNode(id),
  replaceNode: document.createTextNode(id),
} as IBindingInfo);

describe('getBindingInfosByAbsoluteStateAddress', () => {
  it('同一アドレスで同じ配列が返ること', () => {
    const address = createAbsoluteAddress();
    const list1 = getBindingInfosByAbsoluteStateAddress(address);
    const list2 = getBindingInfosByAbsoluteStateAddress(address);

    expect(list1).toBe(list2);
    expect(list1).toEqual([]);
  });

  it('add/removeで配列が更新されること', () => {
    const address = createAbsoluteAddress();
    const binding = createBindingInfo('a');

    addBindingInfoByAbsoluteStateAddress(address, binding);
    expect(getBindingInfosByAbsoluteStateAddress(address)).toContain(binding);

    removeBindingInfoByAbsoluteStateAddress(address, binding);
    expect(getBindingInfosByAbsoluteStateAddress(address)).not.toContain(binding);
  });

  it('存在しないbindingをremoveしても変化しないこと', () => {
    const address = createAbsoluteAddress();
    const binding = createBindingInfo('missing');

    const list = getBindingInfosByAbsoluteStateAddress(address);
    removeBindingInfoByAbsoluteStateAddress(address, binding);

    expect(getBindingInfosByAbsoluteStateAddress(address)).toBe(list);
    expect(list).toHaveLength(0);
  });

  it('clearで配列がリセットされること', () => {
    const address = createAbsoluteAddress('value');
    const binding = createBindingInfo('b');

    addBindingInfoByAbsoluteStateAddress(address, binding);
    const beforeClear = getBindingInfosByAbsoluteStateAddress(address);
    expect(beforeClear).toContain(binding);

    clearBindingInfosByAbsoluteStateAddress(address);
    const afterClear = getBindingInfosByAbsoluteStateAddress(address);

    expect(afterClear).toEqual([]);
    expect(afterClear).not.toBe(beforeClear);
  });
});

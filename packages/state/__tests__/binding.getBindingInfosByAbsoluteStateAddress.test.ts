import { describe, it, expect } from 'vitest';
import {
  getBindingSetByAbsoluteStateAddress,
  addBindingByAbsoluteStateAddress,
  removeBindingByAbsoluteStateAddress,
  clearBindingSetByAbsoluteStateAddress,
} from '../src/binding/getBindingSetByAbsoluteStateAddress';
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

describe('getBindingSetByAbsoluteStateAddress', () => {
  it('同一アドレスで同じSetが返ること', () => {
    const address = createAbsoluteAddress();
    const set1 = getBindingSetByAbsoluteStateAddress(address);
    const set2 = getBindingSetByAbsoluteStateAddress(address);

    expect(set1).toBe(set2);
    expect(set1.size).toBe(0);
  });

  it('add/removeでSetが更新されること', () => {
    const address = createAbsoluteAddress();
    const binding = createBindingInfo('a');

    addBindingByAbsoluteStateAddress(address, binding);
    expect(getBindingSetByAbsoluteStateAddress(address)).toContain(binding);

    removeBindingByAbsoluteStateAddress(address, binding);
    expect(getBindingSetByAbsoluteStateAddress(address)).not.toContain(binding);
  });

  it('存在しないbindingをremoveしても変化しないこと', () => {
    const address = createAbsoluteAddress();
    const binding = createBindingInfo('missing');

    const set = getBindingSetByAbsoluteStateAddress(address);
    removeBindingByAbsoluteStateAddress(address, binding);

    expect(getBindingSetByAbsoluteStateAddress(address)).toBe(set);
    expect(set.size).toBe(0);
  });

  it('clearでSetがリセットされること', () => {
    const address = createAbsoluteAddress('value');
    const binding = createBindingInfo('b');

    addBindingByAbsoluteStateAddress(address, binding);
    const beforeClear = getBindingSetByAbsoluteStateAddress(address);
    expect(beforeClear).toContain(binding);

    clearBindingSetByAbsoluteStateAddress(address);
    const afterClear = getBindingSetByAbsoluteStateAddress(address);

    expect(afterClear.size).toBe(0);
    expect(afterClear).not.toBe(beforeClear);
  });
});

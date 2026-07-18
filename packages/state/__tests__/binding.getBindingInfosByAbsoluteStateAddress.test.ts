import { describe, it, expect } from 'vitest';
import {
  peekBindingsByAbsoluteStateAddress,
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
} as unknown as IAbsoluteStateAddress);

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

describe('絶対アドレス台帳の add / remove / clear', () => {
  it('add/removeで台帳が更新されること', () => {
    const address = createAbsoluteAddress();
    const binding = createBindingInfo('a');

    addBindingByAbsoluteStateAddress(address, binding);
    expect(peekBindingsByAbsoluteStateAddress(address)).toBe(binding);

    removeBindingByAbsoluteStateAddress(address, binding);
    expect(peekBindingsByAbsoluteStateAddress(address)).toBeUndefined();
  });

  it('複数 binding は Set 昇格で共存し、片方の remove で残りが保たれること', () => {
    const address = createAbsoluteAddress();
    const a = createBindingInfo('a');
    const b = createBindingInfo('b');

    addBindingByAbsoluteStateAddress(address, a);
    addBindingByAbsoluteStateAddress(address, b);
    const entry = peekBindingsByAbsoluteStateAddress(address);
    expect(entry).toBeInstanceOf(Set);
    expect((entry as Set<IBindingInfo>).size).toBe(2);

    removeBindingByAbsoluteStateAddress(address, a);
    const after = peekBindingsByAbsoluteStateAddress(address);
    expect(after).toBe(entry);
    expect((after as Set<IBindingInfo>).has(b)).toBe(true);
  });

  it('存在しないbindingをremoveしても変化しないこと', () => {
    const address = createAbsoluteAddress();
    const registered = createBindingInfo('a');
    const missing = createBindingInfo('missing');

    addBindingByAbsoluteStateAddress(address, registered);
    removeBindingByAbsoluteStateAddress(address, missing);

    expect(peekBindingsByAbsoluteStateAddress(address)).toBe(registered);
  });

  it('clearで台帳エントリが消えること', () => {
    const address = createAbsoluteAddress('value');
    const binding = createBindingInfo('b');

    addBindingByAbsoluteStateAddress(address, binding);
    expect(peekBindingsByAbsoluteStateAddress(address)).toBe(binding);

    clearBindingSetByAbsoluteStateAddress(address);
    expect(peekBindingsByAbsoluteStateAddress(address)).toBeUndefined();
  });
});

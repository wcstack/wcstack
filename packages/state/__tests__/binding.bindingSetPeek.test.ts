import { describe, it, expect } from 'vitest';
import {
  getBindingSetByAbsoluteStateAddress,
  peekBindingSetByAbsoluteStateAddress,
  addBindingByAbsoluteStateAddress,
  removeBindingByAbsoluteStateAddress,
} from '../src/binding/getBindingSetByAbsoluteStateAddress';
import type { IAbsoluteStateAddress } from '../src/address/types';
import type { IBindingInfo } from '../src/types';

const makeAddress = (): IAbsoluteStateAddress => ({} as IAbsoluteStateAddress);
const makeBinding = (): IBindingInfo => ({} as IBindingInfo);

describe('bindingSetByAbsoluteStateAddress の peek / remove', () => {
  it('peek は未登録アドレスに空 Set を生成しないこと', () => {
    const address = makeAddress();
    expect(peekBindingSetByAbsoluteStateAddress(address)).toBeUndefined();
    // 2回目も undefined のまま（get-or-create になっていない）
    expect(peekBindingSetByAbsoluteStateAddress(address)).toBeUndefined();
  });

  it('remove は未登録アドレスに空 Set を生成しないこと', () => {
    const address = makeAddress();
    expect(() => removeBindingByAbsoluteStateAddress(address, makeBinding())).not.toThrow();
    expect(peekBindingSetByAbsoluteStateAddress(address)).toBeUndefined();
  });

  it('add 後は peek で同じ Set が参照できること', () => {
    const address = makeAddress();
    const binding = makeBinding();
    addBindingByAbsoluteStateAddress(address, binding);
    const peeked = peekBindingSetByAbsoluteStateAddress(address);
    expect(peeked).toBeDefined();
    expect(peeked!.has(binding)).toBe(true);
  });

  it('remove が登録済みの binding を外すこと', () => {
    const address = makeAddress();
    const binding = makeBinding();
    addBindingByAbsoluteStateAddress(address, binding);
    removeBindingByAbsoluteStateAddress(address, binding);
    expect(peekBindingSetByAbsoluteStateAddress(address)!.size).toBe(0);
  });

  it('get-or-create（getBindingSetByAbsoluteStateAddress）の挙動は従来通りであること', () => {
    const address = makeAddress();
    const created = getBindingSetByAbsoluteStateAddress(address);
    expect(created).toBeInstanceOf(Set);
    // 生成後は peek でも見える
    expect(peekBindingSetByAbsoluteStateAddress(address)).toBe(created);
  });
});

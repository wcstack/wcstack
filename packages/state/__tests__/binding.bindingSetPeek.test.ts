import { describe, it, expect } from 'vitest';
import {
  peekBindingsByAbsoluteStateAddress,
  addBindingByAbsoluteStateAddress,
  removeBindingByAbsoluteStateAddress,
} from '../src/binding/getBindingSetByAbsoluteStateAddress';
import type { IAbsoluteStateAddress } from '../src/address/types';
import type { IBindingInfo } from '../src/types';

const makeAddress = (): IAbsoluteStateAddress => ({} as IAbsoluteStateAddress);
const makeBinding = (): IBindingInfo => ({} as IBindingInfo);

describe('bindingsByAbsoluteStateAddress の peek / remove（単一値昇格台帳）', () => {
  it('peek は未登録アドレスにエントリを生成しないこと', () => {
    const address = makeAddress();
    expect(peekBindingsByAbsoluteStateAddress(address)).toBeUndefined();
    // 2回目も undefined のまま（get-or-create になっていない）
    expect(peekBindingsByAbsoluteStateAddress(address)).toBeUndefined();
  });

  it('remove は未登録アドレスにエントリを生成しないこと', () => {
    const address = makeAddress();
    expect(() => removeBindingByAbsoluteStateAddress(address, makeBinding())).not.toThrow();
    expect(peekBindingsByAbsoluteStateAddress(address)).toBeUndefined();
  });

  it('1本目の add は Set を作らず binding そのものをエントリにすること', () => {
    const address = makeAddress();
    const binding = makeBinding();
    addBindingByAbsoluteStateAddress(address, binding);
    expect(peekBindingsByAbsoluteStateAddress(address)).toBe(binding);
  });

  it('同一 binding の重複 add はエントリを変えないこと', () => {
    const address = makeAddress();
    const binding = makeBinding();
    addBindingByAbsoluteStateAddress(address, binding);
    addBindingByAbsoluteStateAddress(address, binding);
    expect(peekBindingsByAbsoluteStateAddress(address)).toBe(binding);
  });

  it('2本目の add で Set に昇格し両方を含むこと', () => {
    const address = makeAddress();
    const first = makeBinding();
    const second = makeBinding();
    addBindingByAbsoluteStateAddress(address, first);
    addBindingByAbsoluteStateAddress(address, second);
    const entry = peekBindingsByAbsoluteStateAddress(address);
    expect(entry).toBeInstanceOf(Set);
    expect((entry as Set<IBindingInfo>).has(first)).toBe(true);
    expect((entry as Set<IBindingInfo>).has(second)).toBe(true);
  });

  it('Set 昇格後の add は同じ Set に追加されること', () => {
    const address = makeAddress();
    const first = makeBinding();
    const second = makeBinding();
    const third = makeBinding();
    addBindingByAbsoluteStateAddress(address, first);
    addBindingByAbsoluteStateAddress(address, second);
    const promoted = peekBindingsByAbsoluteStateAddress(address);
    addBindingByAbsoluteStateAddress(address, third);
    expect(peekBindingsByAbsoluteStateAddress(address)).toBe(promoted);
    expect((promoted as Set<IBindingInfo>).size).toBe(3);
  });

  it('単一エントリの remove はエントリごと消すこと', () => {
    const address = makeAddress();
    const binding = makeBinding();
    addBindingByAbsoluteStateAddress(address, binding);
    removeBindingByAbsoluteStateAddress(address, binding);
    expect(peekBindingsByAbsoluteStateAddress(address)).toBeUndefined();
  });

  it('単一エントリと異なる binding の remove はエントリを変えないこと', () => {
    const address = makeAddress();
    const binding = makeBinding();
    addBindingByAbsoluteStateAddress(address, binding);
    removeBindingByAbsoluteStateAddress(address, makeBinding());
    expect(peekBindingsByAbsoluteStateAddress(address)).toBe(binding);
  });

  it('Set 昇格後の remove は Set から外すこと（Set は維持）', () => {
    const address = makeAddress();
    const first = makeBinding();
    const second = makeBinding();
    addBindingByAbsoluteStateAddress(address, first);
    addBindingByAbsoluteStateAddress(address, second);
    removeBindingByAbsoluteStateAddress(address, first);
    const entry = peekBindingsByAbsoluteStateAddress(address);
    expect(entry).toBeInstanceOf(Set);
    expect((entry as Set<IBindingInfo>).has(first)).toBe(false);
    expect((entry as Set<IBindingInfo>).has(second)).toBe(true);
  });
});

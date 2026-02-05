import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';
import { createStateAddress } from '../src/address/StateAddress';
import { getPathInfo } from '../src/address/PathInfo';
import { setStateElementByName } from '../src/stateElementByName';

function createStateElement() {
  return {
    mightChangeByPath: new Map()
  } as any;
}

describe('AbsoluteStateAddress', () => {
  afterEach(() => {
    setStateElementByName('test', null);
    setStateElementByName('test2', null);
  });

  it('stateElementが存在しない場合はエラーになること', () => {
    const address = createStateAddress(getPathInfo('count'), null);
    expect(() => createAbsoluteStateAddress('notfound', address))
      .toThrow(/State element with name "notfound" not found/);
  });

  it('新規のstateElementとアドレスでAbsoluteStateAddressが作成されること', () => {
    const stateElement = createStateElement();
    setStateElementByName('test', stateElement);
    
    const address = createStateAddress(getPathInfo('count'), null);
    const absoluteAddress = createAbsoluteStateAddress('test', address);

    expect(absoluteAddress).toBeDefined();
    expect(absoluteAddress.stateName).toBe('test');
    expect(absoluteAddress.address).toBe(address);
    expect(Object.isFrozen(absoluteAddress)).toBe(true);
  });

  it('同一のstateElement/アドレスで呼び出すとキャッシュから返されること', () => {
    const stateElement = createStateElement();
    setStateElementByName('test', stateElement);
    
    const address = createStateAddress(getPathInfo('count'), null);
    const absoluteAddress1 = createAbsoluteStateAddress('test', address);
    const absoluteAddress2 = createAbsoluteStateAddress('test', address);

    // 同一のインスタンスが返されることを確認
    expect(absoluteAddress1).toBe(absoluteAddress2);
  });

  it('同一のstateElementで異なるアドレスの場合は新規作成されること', () => {
    const stateElement = createStateElement();
    setStateElementByName('test', stateElement);
    
    const address1 = createStateAddress(getPathInfo('count'), null);
    const address2 = createStateAddress(getPathInfo('name'), null);
    
    const absoluteAddress1 = createAbsoluteStateAddress('test', address1);
    const absoluteAddress2 = createAbsoluteStateAddress('test', address2);

    // 異なるインスタンスが返されることを確認
    expect(absoluteAddress1).not.toBe(absoluteAddress2);
    expect(absoluteAddress1.address).toBe(address1);
    expect(absoluteAddress2.address).toBe(address2);
  });

  it('異なるstateElementでは別々にキャッシュされること', () => {
    const stateElement1 = createStateElement();
    const stateElement2 = createStateElement();
    setStateElementByName('test', stateElement1);
    setStateElementByName('test2', stateElement2);
    
    const address = createStateAddress(getPathInfo('count'), null);
    
    const absoluteAddress1 = createAbsoluteStateAddress('test', address);
    const absoluteAddress2 = createAbsoluteStateAddress('test2', address);

    // 異なるstateNameなので異なるインスタンス
    expect(absoluteAddress1).not.toBe(absoluteAddress2);
    expect(absoluteAddress1.stateName).toBe('test');
    expect(absoluteAddress2.stateName).toBe('test2');
  });
});

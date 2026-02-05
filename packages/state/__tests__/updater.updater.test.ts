import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { getUpdater } from '../src/updater/updater';
import { setStateElementByName } from '../src/stateElementByName';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';
import { createStateAddress } from '../src/address/StateAddress';
import { getPathInfo } from '../src/address/PathInfo';
import { addBindingInfoByAbsoluteStateAddress } from '../src/binding/getBindingInfosByAbsoluteStateAddress';

vi.mock('../src/apply/applyChangeFromBindings', () => ({
  applyChangeFromBindings: vi.fn()
}));

import { applyChangeFromBindings } from '../src/apply/applyChangeFromBindings';

const applyChangeFromBindingsMock = vi.mocked(applyChangeFromBindings);

function createAddress(path: string) {
  return createStateAddress(getPathInfo(path), null);
}

function createStateElement() {
  return {} as any;
}

describe('updater/updater', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setStateElementByName('default', null);
    setStateElementByName('missing', null);
  });

  it('stateElementが見つからない場合はエラーになること', async () => {
    const address = createAddress('count');
    // stateElementが存在しない状態でAbsoluteStateAddressを作成しようとするとエラー
    expect(() => createAbsoluteStateAddress('missing', address)).toThrow(/State element with name "missing" not found/);
  });

  it('enqueueでapplyChangeFromBindingsが呼ばれること', async () => {
    const address = createAddress('count');
    const bindingInfo = { propName: 'value', stateName: 'default', node: document.createTextNode('') } as any;
    const stateElement = createStateElement();
    setStateElementByName('default', stateElement);

    const updater = getUpdater();
    const absoluteAddress = createAbsoluteStateAddress('default', address);
    addBindingInfoByAbsoluteStateAddress(absoluteAddress, bindingInfo);

    updater.enqueueAbsoluteAddress(absoluteAddress);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    expect(applyChangeFromBindingsMock).toHaveBeenCalledWith([bindingInfo]);
  });

  it('同一フレームで複数enqueueしても処理は一度だけ行われること', async () => {
    const address = createAddress('value');
    const bindingInfo = { propName: 'value', stateName: 'default', node: document.createTextNode('') } as any;
    const stateElement = createStateElement();
    setStateElementByName('default', stateElement);

    const updater = getUpdater();
    const absoluteAddress = createAbsoluteStateAddress('default', address);
    addBindingInfoByAbsoluteStateAddress(absoluteAddress, bindingInfo);

    updater.enqueueAbsoluteAddress(absoluteAddress);
    updater.enqueueAbsoluteAddress(absoluteAddress);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    // 同一のAbsoluteStateAddressはSetで重複排除される
    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    expect(applyChangeFromBindingsMock).toHaveBeenCalledWith([bindingInfo]);
  });

  it('bindingInfosが無い場合は空配列でapplyChangeFromBindingsが呼ばれること', async () => {
    const address = createAddress('missing');
    const stateElement = createStateElement();
    setStateElementByName('default', stateElement);

    const updater = getUpdater();
    const absoluteAddress = createAbsoluteStateAddress('default', address);

    updater.enqueueAbsoluteAddress(absoluteAddress);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    expect(applyChangeFromBindingsMock).toHaveBeenCalledWith([]);
  });

  it('getUpdaterはシングルトンを返すこと', () => {
    const updater1 = getUpdater();
    const updater2 = getUpdater();
    expect(updater1).toBe(updater2);
  });

  it('複数のstateNameのアドレスを一括処理できること', async () => {
    const address1 = createAddress('count');
    const address2 = createAddress('name');
    
    const bindingInfo1 = { propName: 'value', stateName: 'state1', node: document.createTextNode('') } as any;
    const bindingInfo2 = { propName: 'text', stateName: 'state2', node: document.createTextNode('') } as any;
    
    const stateElement1 = createStateElement();
    const stateElement2 = createStateElement();
    
    setStateElementByName('state1', stateElement1);
    setStateElementByName('state2', stateElement2);

    const updater = getUpdater();
    const absoluteAddress1 = createAbsoluteStateAddress('state1', address1);
    const absoluteAddress2 = createAbsoluteStateAddress('state2', address2);

    addBindingInfoByAbsoluteStateAddress(absoluteAddress1, bindingInfo1);
    addBindingInfoByAbsoluteStateAddress(absoluteAddress2, bindingInfo2);

    updater.enqueueAbsoluteAddress(absoluteAddress1);
    updater.enqueueAbsoluteAddress(absoluteAddress2);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    expect(applyChangeFromBindingsMock).toHaveBeenCalledWith([bindingInfo1, bindingInfo2]);

    setStateElementByName('state1', null);
    setStateElementByName('state2', null);
  });
});
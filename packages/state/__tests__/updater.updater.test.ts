import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { getUpdater } from '../src/updater/updater';
import { setStateElementByName } from '../src/stateElementByName';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
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

function createAbsAddress(stateName: string, path: string) {
  const pathInfo = getPathInfo(path);
  const absPathInfo = getAbsolutePathInfo(stateName, pathInfo);
  return createAbsoluteStateAddress(absPathInfo, null);
}

function createStateElement() {
  return {} as any;
}

describe('updater/updater', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setStateElementByName(document, 'default', null);
    setStateElementByName(document, 'missing', null);
  });

  it('stateElementが見つからない場合でもAbsoluteStateAddressは作成できること', async () => {
    // 新しいAPIではstateElementの存在チェックはcreateAbsoluteStateAddress内で行われない
    const absoluteAddress = createAbsAddress('missing', 'count');
    expect(absoluteAddress).toBeDefined();
    expect(absoluteAddress.absolutePathInfo.stateName).toBe('missing');
  });

  it('enqueueでapplyChangeFromBindingsが呼ばれること', async () => {
    const address = createAddress('count');
    const bindingInfo = { propName: 'value', stateName: 'default', node: document.createTextNode('') } as any;
    const stateElement = createStateElement();
    setStateElementByName(document, 'default', stateElement);

    const updater = getUpdater();
    const absoluteAddress = createAbsAddress('default', address.pathInfo.path);
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
    setStateElementByName(document, 'default', stateElement);

    const updater = getUpdater();
    const absoluteAddress = createAbsAddress('default', address.pathInfo.path);
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
    setStateElementByName(document, 'default', stateElement);

    const updater = getUpdater();
    const absoluteAddress = createAbsAddress('default', address.pathInfo.path);

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
    
    setStateElementByName(document, 'state1', stateElement1);
    setStateElementByName(document, 'state2', stateElement2);

    const updater = getUpdater();
    const absoluteAddress1 = createAbsAddress('state1', address1.pathInfo.path);
    const absoluteAddress2 = createAbsAddress('state2', address2.pathInfo.path);

    addBindingInfoByAbsoluteStateAddress(absoluteAddress1, bindingInfo1);
    addBindingInfoByAbsoluteStateAddress(absoluteAddress2, bindingInfo2);

    updater.enqueueAbsoluteAddress(absoluteAddress1);
    updater.enqueueAbsoluteAddress(absoluteAddress2);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    expect(applyChangeFromBindingsMock).toHaveBeenCalledWith([bindingInfo1, bindingInfo2]);

    setStateElementByName(document, 'state1', null);
    setStateElementByName(document, 'state2', null);
  });
});
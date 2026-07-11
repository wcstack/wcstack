import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { getUpdater, registerUpdateBatchListener, unregisterUpdateBatchListener, type UpdateBatchListener } from '../src/updater/updater';
import { setStateElementByName } from '../src/stateElementByName';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
import { createStateAddress } from '../src/address/StateAddress';
import { getPathInfo } from '../src/address/PathInfo';
import { addBindingByAbsoluteStateAddress, clearBindingSetByAbsoluteStateAddress } from '../src/binding/getBindingSetByAbsoluteStateAddress';
import { IAbsoluteStateAddress } from '../src/address/types';
import type { IStateElement } from '../src/components/types';

vi.mock('../src/apply/applyChangeFromBindings', () => ({
  applyChangeFromBindings: vi.fn()
}));

import { applyChangeFromBindings } from '../src/apply/applyChangeFromBindings';

const applyChangeFromBindingsMock = vi.mocked(applyChangeFromBindings);

function createAddress(path: string) {
  return createStateAddress(getPathInfo(path), null);
}

function createAbsAddress(stateElement: any, path: string) {
  const pathInfo = getPathInfo(path);
  const absPathInfo = getAbsolutePathInfo(stateElement, pathInfo);
  return createAbsoluteStateAddress(absPathInfo, null);
}

function createStateElement(name: string = 'default') {
  return { name } as IStateElement;
}

describe('updater/updater', () => {
  const createdAbsAddresses: IAbsoluteStateAddress[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setStateElementByName(document, 'default', null);
    setStateElementByName(document, 'missing', null);
    for (const addr of createdAbsAddresses) {
      clearBindingSetByAbsoluteStateAddress(addr);
    }
    createdAbsAddresses.length = 0;
  });

  it('stateElementが見つからない場合でもAbsoluteStateAddressは作成できること', async () => {
    // 新しいAPIではstateElementの存在チェックはcreateAbsoluteStateAddress内で行われない
    const missingStateElement = createStateElement('missing');
    const absoluteAddress = createAbsAddress(missingStateElement, 'count');
    expect(absoluteAddress).toBeDefined();
    expect(absoluteAddress.absolutePathInfo.stateName).toBe('missing');
  });

  it('enqueueでapplyChangeFromBindingsが呼ばれること', async () => {
    const address = createAddress('count');
    const replaceNode = document.createElement('div');
    document.body.appendChild(replaceNode);
    const bindingInfo = { propName: 'value', stateName: 'default', node: document.createTextNode(''), replaceNode } as any;
    const stateElement = createStateElement('default');
    setStateElementByName(document, 'default', stateElement);

    const updater = getUpdater();
    const absoluteAddress = createAbsAddress(stateElement, address.pathInfo.path);
    addBindingByAbsoluteStateAddress(absoluteAddress, bindingInfo);

    updater.enqueueAbsoluteAddress(absoluteAddress);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    expect(applyChangeFromBindingsMock).toHaveBeenCalledWith([bindingInfo]);
  });

  it('同一フレームで複数enqueueしても処理は一度だけ行われること', async () => {
    const address = createAddress('value');
    const replaceNode = document.createElement('div');
    document.body.appendChild(replaceNode);
    const bindingInfo = { propName: 'value', stateName: 'default', node: document.createTextNode(''), replaceNode } as any;
    const stateElement = createStateElement('default');
    setStateElementByName(document, 'default', stateElement);

    const updater = getUpdater();
    const absoluteAddress = createAbsAddress(stateElement, address.pathInfo.path);
    addBindingByAbsoluteStateAddress(absoluteAddress, bindingInfo);

    updater.enqueueAbsoluteAddress(absoluteAddress);
    updater.enqueueAbsoluteAddress(absoluteAddress);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    // 同一のAbsoluteStateAddressはSetで重複排除される
    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    expect(applyChangeFromBindingsMock).toHaveBeenCalledWith([bindingInfo]);
  });

  it('bindingInfosが無い場合は空配列でapplyChangeFromBindingsが呼ばれること', async () => {
    const address = createAddress('missing');
    const stateElement = createStateElement('default');
    setStateElementByName(document, 'default', stateElement);

    const updater = getUpdater();
    const absoluteAddress = createAbsAddress(stateElement, address.pathInfo.path);

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
    
    const replaceNode1 = document.createElement('div');
    document.body.appendChild(replaceNode1);
    const replaceNode2 = document.createElement('div');
    document.body.appendChild(replaceNode2);
    const bindingInfo1 = { propName: 'value', stateName: 'state1', node: document.createTextNode(''), replaceNode: replaceNode1 } as any;
    const bindingInfo2 = { propName: 'text', stateName: 'state2', node: document.createTextNode(''), replaceNode: replaceNode2 } as any;
    
    const stateElement1 = createStateElement('state1');
    const stateElement2 = createStateElement('state2');

    setStateElementByName(document, 'state1', stateElement1);
    setStateElementByName(document, 'state2', stateElement2);

    const updater = getUpdater();
    const absoluteAddress1 = createAbsAddress(stateElement1, address1.pathInfo.path);
    const absoluteAddress2 = createAbsAddress(stateElement2, address2.pathInfo.path);

    addBindingByAbsoluteStateAddress(absoluteAddress1, bindingInfo1);
    addBindingByAbsoluteStateAddress(absoluteAddress2, bindingInfo2);

    updater.enqueueAbsoluteAddress(absoluteAddress1);
    updater.enqueueAbsoluteAddress(absoluteAddress2);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    expect(applyChangeFromBindingsMock).toHaveBeenCalledWith([bindingInfo1, bindingInfo2]);

    setStateElementByName(document, 'state1', null);
    setStateElementByName(document, 'state2', null);
  });

  it('testApplyChangeで同期的にapplyChangeFromBindingsが呼ばれること', () => {
    const address = createAddress('testSync');
    const replaceNode = document.createElement('div');
    document.body.appendChild(replaceNode);
    const bindingInfo = { propName: 'value', stateName: 'default', node: document.createTextNode(''), replaceNode } as any;
    const stateElement = createStateElement('default');
    setStateElementByName(document, 'default', stateElement);

    const updater = getUpdater();
    const absoluteAddress = createAbsAddress(stateElement, address.pathInfo.path);
    createdAbsAddresses.push(absoluteAddress);
    addBindingByAbsoluteStateAddress(absoluteAddress, bindingInfo);

    updater.testApplyChange([absoluteAddress]);

    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    expect(applyChangeFromBindingsMock).toHaveBeenCalledWith([bindingInfo]);
  });

  it('切断されたreplaceNodeを持つバインディングはスキップされること', async () => {
    const address = createAddress('disconnectTest');
    const connectedNode = document.createElement('div');
    document.body.appendChild(connectedNode);
    const disconnectedNode = document.createElement('div');
    // disconnectedNode は document.body に追加しない（isConnected === false）

    const bindingConnected = { propName: 'value', stateName: 'default', node: document.createTextNode(''), replaceNode: connectedNode } as any;
    const bindingDisconnected = { propName: 'value', stateName: 'default', node: document.createTextNode(''), replaceNode: disconnectedNode } as any;

    const stateElement = createStateElement('default');
    setStateElementByName(document, 'default', stateElement);

    const updater = getUpdater();
    const absoluteAddress = createAbsAddress(stateElement, address.pathInfo.path);
    createdAbsAddresses.push(absoluteAddress);
    addBindingByAbsoluteStateAddress(absoluteAddress, bindingConnected);
    addBindingByAbsoluteStateAddress(absoluteAddress, bindingDisconnected);

    updater.enqueueAbsoluteAddress(absoluteAddress);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    // 切断されたバインディングは除外され、接続済みのもののみ渡される
    expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    expect(applyChangeFromBindingsMock).toHaveBeenCalledWith([bindingConnected]);
  });

  describe('drain 終了フック（UpdateBatchListener・設計書 §3-2）', () => {
    const registeredListeners: UpdateBatchListener[] = [];

    // テスト間の分離: 登録したリスナーは必ず解除する（updater はシングルトン）
    function register(listener: UpdateBatchListener): void {
      registerUpdateBatchListener(listener);
      registeredListeners.push(listener);
    }

    afterEach(() => {
      for (const listener of registeredListeners) {
        unregisterUpdateBatchListener(listener);
      }
      registeredListeners.length = 0;
    });

    it('enqueue後のmicrotask drainでリスナーがdedup済みのSetを受け取ること', async () => {
      const stateElement = createStateElement('default');
      setStateElementByName(document, 'default', stateElement);

      const updater = getUpdater();
      const absoluteAddress1 = createAbsAddress(stateElement, 'batchDep1');
      const absoluteAddress2 = createAbsAddress(stateElement, 'batchDep2');

      const listener = vi.fn();
      register(listener);

      updater.enqueueAbsoluteAddress(absoluteAddress1);
      updater.enqueueAbsoluteAddress(absoluteAddress1); // 同一インスタンスの重複はdedupされる
      updater.enqueueAbsoluteAddress(absoluteAddress2);
      await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

      expect(listener).toHaveBeenCalledTimes(1);
      const batch = listener.mock.calls[0][0] as ReadonlySet<IAbsoluteStateAddress>;
      expect(batch.size).toBe(2);
      expect(batch.has(absoluteAddress1)).toBe(true);
      expect(batch.has(absoluteAddress2)).toBe(true);
    });

    it('testApplyChangeで同期にリスナーが発火すること（applyChangeFromBindingsの後）', () => {
      const stateElement = createStateElement('default');
      setStateElementByName(document, 'default', stateElement);

      const updater = getUpdater();
      const absoluteAddress = createAbsAddress(stateElement, 'batchSync');

      const listener = vi.fn();
      register(listener);

      updater.testApplyChange([absoluteAddress]);

      expect(listener).toHaveBeenCalledTimes(1);
      const batch = listener.mock.calls[0][0] as ReadonlySet<IAbsoluteStateAddress>;
      expect(batch.has(absoluteAddress)).toBe(true);
      // 通知は _applyChange の末尾 = applyChangeFromBindings の後
      expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
      expect(applyChangeFromBindingsMock.mock.invocationCallOrder[0])
        .toBeLessThan(listener.mock.invocationCallOrder[0]);
    });

    it('unregister後のdrainではリスナーが呼ばれないこと', () => {
      const stateElement = createStateElement('default');
      setStateElementByName(document, 'default', stateElement);

      const updater = getUpdater();
      const absoluteAddress = createAbsAddress(stateElement, 'batchUnregister');

      const listener = vi.fn();
      register(listener);
      unregisterUpdateBatchListener(listener);

      updater.testApplyChange([absoluteAddress]);

      expect(listener).not.toHaveBeenCalled();
    });

    it('リスナーが2つ登録されていれば両方が同じバッチで呼ばれること', () => {
      const stateElement = createStateElement('default');
      setStateElementByName(document, 'default', stateElement);

      const updater = getUpdater();
      const absoluteAddress = createAbsAddress(stateElement, 'batchTwoListeners');

      const listener1 = vi.fn();
      const listener2 = vi.fn();
      register(listener1);
      register(listener2);

      updater.testApplyChange([absoluteAddress]);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
      // 同一の Set インスタンスが渡される
      expect(listener1.mock.calls[0][0]).toBe(listener2.mock.calls[0][0]);
    });

    it('リスナーのthrowは握りつぶされず伝播すること（設計書§3-2: stream側リスナーがentryごとに自前でtry/catchする契約）', () => {
      const stateElement = createStateElement('default');
      setStateElementByName(document, 'default', stateElement);

      const updater = getUpdater();
      const absoluteAddress = createAbsAddress(stateElement, 'batchThrow');

      const listenerError = new Error('listener error');
      const throwingListener = vi.fn(() => {
        throw listenerError;
      });
      const laterListener = vi.fn();
      register(throwingListener);
      register(laterListener);

      expect(() => updater.testApplyChange([absoluteAddress])).toThrow(listenerError);
      expect(throwingListener).toHaveBeenCalledTimes(1);
      // 現状の特性化: throw は通知ループを中断し、後続リスナーには届かない
      expect(laterListener).not.toHaveBeenCalled();
      // binding 適用（drain 本体）はリスナー通知より前に完了している
      expect(applyChangeFromBindingsMock).toHaveBeenCalledTimes(1);
    });
  });
});
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createUpdater } from '../src/updater/updater';
import { setStateElementByName } from '../src/stateElementByName';

vi.mock('../src/apply/applyChange', () => ({
  applyChange: vi.fn()
}));

import { applyChange } from '../src/apply/applyChange';

const applyChangeMock = vi.mocked(applyChange);

function createAddress(path: string) {
  return { pathInfo: { path } } as any;
}

function createStateElement(bindingInfosByAddress?: Map<any, any[]>) {
  return {
    bindingInfosByAddress: bindingInfosByAddress ?? new Map(),
    mightChangeByPath: new Map()
  } as any;
}

describe('updater/updater', () => {
  afterEach(() => {
    vi.clearAllMocks();
    setStateElementByName('default', null);
    setStateElementByName('missing', null);
  });

  it('stateElementが見つからない場合はエラーになること', () => {
    const state = { $$getByAddress: vi.fn() } as any;
    expect(() => createUpdater('missing', state, 1)).toThrow(/Updater: State element/);
  });

  it('enqueueでapplyChangeが呼ばれ、versionInfoとmightChangeが更新されること', async () => {
    const address = createAddress('count');
    const bindingInfo = { propName: 'value' } as any;
    const bindingInfosByAddress = new Map([[address, [bindingInfo]]]);
    const stateElement = createStateElement(bindingInfosByAddress);
    setStateElementByName('default', stateElement);

    const state = { $$getByAddress: vi.fn(() => 5) } as any;
    const updater = createUpdater('default', state, 3);

    updater.enqueueUpdateAddress(address);
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(applyChangeMock).toHaveBeenCalledTimes(1);
    expect(applyChangeMock).toHaveBeenCalledWith(bindingInfo, 5);
    expect(updater.versionInfo).toEqual({ version: 3, revision: 1 });
    expect(stateElement.mightChangeByPath.get('count')).toEqual({ version: 3, revision: 1 });
  });

  it('同一フレームで複数enqueueしても処理は一度だけ行われること', async () => {
    const address = createAddress('value');
    const bindingInfo = { propName: 'value' } as any;
    const bindingInfosByAddress = new Map([[address, [bindingInfo]]]);
    const stateElement = createStateElement(bindingInfosByAddress);
    setStateElementByName('default', stateElement);

    const state = { $$getByAddress: vi.fn(() => 10) } as any;
    const updater = createUpdater('default', state, 1);

    updater.enqueueUpdateAddress(address);
    updater.enqueueUpdateAddress(address);
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(applyChangeMock).toHaveBeenCalledTimes(1);
    expect(updater.versionInfo.revision).toBe(2);
    expect(stateElement.mightChangeByPath.get('value')?.revision).toBe(2);
  });

  it('bindingInfosが無い場合はapplyChangeされないこと', async () => {
    const address = createAddress('missing');
    const stateElement = createStateElement();
    setStateElementByName('default', stateElement);

    const state = { $$getByAddress: vi.fn(() => 'x') } as any;
    const updater = createUpdater('default', state, 2);

    updater.enqueueUpdateAddress(address);
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(state.$$getByAddress).toHaveBeenCalledWith(address);
    expect(applyChangeMock).not.toHaveBeenCalled();
    expect(stateElement.mightChangeByPath.get('missing')).toEqual({ version: 2, revision: 1 });
  });

  it('_applyResolveがnullの場合は解放処理を行わないこと', () => {
    const stateElement = createStateElement();
    setStateElementByName('default', stateElement);
    const state = { $$getByAddress: vi.fn() } as any;
    const updater = createUpdater('default', state, 1) as any;

    updater._applyResolve = null;
    updater._processUpdates();

    expect(applyChangeMock).not.toHaveBeenCalled();
  });
});
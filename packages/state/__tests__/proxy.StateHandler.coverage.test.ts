import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/stateElementByName', () => ({
  getStateElementByName: vi.fn(),
}));

vi.mock('../src/updater/updater', () => ({
  createUpdater: vi.fn(() => ({ __updater: true })),
}));

vi.mock('../src/proxy/traps/get', () => ({
  get: vi.fn(() => 'get-result'),
}));

vi.mock('../src/proxy/traps/set', () => ({
  set: vi.fn(() => true),
}));

import { __private__, createStateProxy } from '../src/proxy/StateHandler';
import { getStateElementByName } from '../src/stateElementByName';
import { createUpdater } from '../src/updater/updater';
import { get as trapGet } from '../src/proxy/traps/get';
import { set as trapSet } from '../src/proxy/traps/set';

const { StateHandler } = __private__;

function mockStateElement(nextVersionValue = 1) {
  return { nextVersion: vi.fn(() => nextVersionValue) } as any;
}

describe('proxy/StateHandler (coverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stateElementが存在しない場合はエラーになること', () => {
    vi.mocked(getStateElementByName).mockReturnValue(null as any);
    expect(() => new StateHandler('missing', 'readonly')).toThrow(/State element with name "missing" not found/);
  });

  it('lastAddressStackが空ならnullを返すこと', () => {
    const stateElement = mockStateElement();
    vi.mocked(getStateElementByName).mockReturnValue(stateElement);
    const handler = new StateHandler('default', 'readonly');
    expect(handler.lastAddressStack).toBeNull();
    expect(handler.addressStackIndex).toBe(-1);
    expect(handler.stateName).toBe('default');
    expect(handler.stateElement).toBe(stateElement);
    expect(handler.addressStack).toEqual([]);
  });

  it('push/popでスタックが更新されること', () => {
    vi.mocked(getStateElementByName).mockReturnValue(mockStateElement());
    const handler = new StateHandler('default', 'readonly');

    const addrA = { id: 'a' } as any;
    const addrB = { id: 'b' } as any;
    const addrC = { id: 'c' } as any;

    handler.pushAddress(addrA);
    handler.pushAddress(addrB);
    expect(handler.lastAddressStack).toBe(addrB);

    expect(handler.popAddress()).toBe(addrB);
    // reuse existing slot (else branch)
    handler.pushAddress(addrC);
    expect(handler.lastAddressStack).toBe(addrC);
  });

  it('空スタックのpopはnullを返すこと', () => {
    vi.mocked(getStateElementByName).mockReturnValue(mockStateElement());
    const handler = new StateHandler('default', 'readonly');
    expect(handler.popAddress()).toBeNull();
  });

  it('updater未設定で取得するとエラーになること', () => {
    vi.mocked(getStateElementByName).mockReturnValue(mockStateElement());
    const handler = new StateHandler('default', 'readonly');
    expect(() => handler.updater).toThrow(/updater is not set yet/);
  });

  it('loopContextのset/clearができること', () => {
    vi.mocked(getStateElementByName).mockReturnValue(mockStateElement());
    const handler = new StateHandler('default', 'readonly');
    const loopContext = { elementPathInfo: {} as any, listIndex: {} as any } as any;

    handler.setLoopContext(loopContext);
    expect(handler.loopContext).toBe(loopContext);

    handler.clearLoopContext();
    expect(handler.loopContext).toBeUndefined();
  });

  it('get/set/hasがtrapとReflectへ委譲されること', () => {
    vi.mocked(getStateElementByName).mockReturnValue(mockStateElement());
    const handler = new StateHandler('default', 'writable');
    const target = { value: 1 } as any;

    expect(handler.get(target, 'value', target)).toBe('get-result');
    expect(trapGet).toHaveBeenCalled();

    expect(handler.set(target, 'value', 2, target)).toBe(true);
    expect(trapSet).toHaveBeenCalled();

    expect(handler.has(target, 'value')).toBe(true);
    expect(handler.has(target, 'missing')).toBe(false);
  });

  it('readonlyではsetでエラーになること', () => {
    vi.mocked(getStateElementByName).mockReturnValue(mockStateElement());
    const handler = new StateHandler('default', 'readonly');
    const target = { value: 1 } as any;

    expect(() => handler.set(target, 'value', 2, target)).toThrow(/State "default" is readonly/);
    expect(trapSet).not.toHaveBeenCalled();
  });

  it('createStateProxyがupdaterを生成すること', () => {
    const stateElement = mockStateElement(7);
    vi.mocked(getStateElementByName).mockReturnValue(stateElement);

    const state = { count: 1 };
    createStateProxy(state, 'default', 'writable');

    expect(createUpdater).toHaveBeenCalledTimes(1);
    const [stateName, _stateProxy, version] = vi.mocked(createUpdater).mock.calls[0];
    expect(stateName).toBe('default');
    expect(version).toBe(7);
  });

});

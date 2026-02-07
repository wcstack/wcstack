import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IBindingInfo } from '../src/types';

vi.mock('../src/stateElementByName', () => ({
  getStateElementByName: vi.fn(),
}));

vi.mock('../src/list/loopContextByNode', () => ({
  getLoopContextByNode: vi.fn(),
}));

vi.mock('../src/raiseError', () => ({
  raiseError: vi.fn(),
}));

import { attachTwowayEventHandler, detachTwowayEventHandler, __private__ } from '../src/event/twowayHandler';
import { getPathInfo } from '../src/address/PathInfo';
import { getStateElementByName } from '../src/stateElementByName';
import { getLoopContextByNode } from '../src/list/loopContextByNode';
import { raiseError } from '../src/raiseError';

function createBindingInfo(node: Element, overrides?: Partial<IBindingInfo>): IBindingInfo {
  return {
    propName: 'value',
    propSegments: ['value'],
    propModifiers: [],
    statePathName: 'users.*.name',
    statePathInfo: getPathInfo('users.*.name'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'prop',
    uuid: null,
    node,
    replaceNode: node,
    ...overrides,
  } as IBindingInfo;
}

describe('event/twowayHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __private__.handlerByHandlerKey.clear();
    __private__.bindingInfoSetByHandlerKey.clear();
  });

  it('two-way対象でイベントを登録できること', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    const addSpy = vi.spyOn(input, 'addEventListener');

    const binding = createBindingInfo(input, { statePathName: 'users.*.name-input' });
    expect(attachTwowayEventHandler(binding)).toBe(true);
    expect(addSpy).toHaveBeenCalledWith('input', expect.any(Function));
  });

  it('modifierでイベント名を変更できること', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    const addSpy = vi.spyOn(input, 'addEventListener');

    const binding = createBindingInfo(input, { propModifiers: ['onchange'], statePathName: 'users.*.name-change' });
    attachTwowayEventHandler(binding);
    expect(addSpy).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('on以外の修飾子はイベント名に影響しないこと', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    const addSpy = vi.spyOn(input, 'addEventListener');

    const binding = createBindingInfo(input, { propModifiers: ['lazy'], statePathName: 'users.*.name-lazy' });
    attachTwowayEventHandler(binding);
    expect(addSpy).toHaveBeenCalledWith('input', expect.any(Function));
  });

  it('同じキーならハンドラを共有すること', () => {
    const input1 = document.createElement('input');
    input1.setAttribute('type', 'text');
    const input2 = document.createElement('input');
    input2.setAttribute('type', 'text');

    const addSpy1 = vi.spyOn(input1, 'addEventListener');
    const addSpy2 = vi.spyOn(input2, 'addEventListener');

    const binding1 = createBindingInfo(input1, { statePathName: 'users.*.name-share' });
    const binding2 = createBindingInfo(input2, { statePathName: 'users.*.name-share' });

    attachTwowayEventHandler(binding1);
    attachTwowayEventHandler(binding2);

    const handler1 = addSpy1.mock.calls[0]?.[1];
    const handler2 = addSpy2.mock.calls[0]?.[1];
    expect(handler1).toBe(handler2);
  });

  it('detachTwowayEventHandlerで解除できること', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    const addSpy = vi.spyOn(input, 'addEventListener');
    const removeSpy = vi.spyOn(input, 'removeEventListener');

    const binding = createBindingInfo(input, { statePathName: 'users.*.name-detach' });
    attachTwowayEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1];

    expect(detachTwowayEventHandler(binding)).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith('input', handler);
    const eventName = __private__.getEventName(binding);
    const key = __private__.getHandlerKey(binding, eventName);
    expect(__private__.handlerByHandlerKey.has(key)).toBe(false);
    expect(__private__.bindingInfoSetByHandlerKey.has(key)).toBe(false);
    expect(detachTwowayEventHandler(binding)).toBe(false);
  });

  it('two-way対象外はfalseを返すこと', () => {
    const div = document.createElement('div');
    const binding = createBindingInfo(div, { propName: 'value', statePathName: 'users.*.name-non' });
    expect(attachTwowayEventHandler(binding)).toBe(false);
  });

  it('detachでtwo-way対象外ならfalseを返すこと', () => {
    const div = document.createElement('div');
    const binding = createBindingInfo(div, { propName: 'value', statePathName: 'users.*.name-non-detach' });
    expect(detachTwowayEventHandler(binding)).toBe(false);
  });

  it('select要素はchangeイベントを使うこと', () => {
    const select = document.createElement('select');
    const addSpy = vi.spyOn(select, 'addEventListener');

    const binding = createBindingInfo(select, { statePathName: 'users.*.name-select' });
    expect(attachTwowayEventHandler(binding)).toBe(true);
    expect(addSpy).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('ro修飾子がある場合は登録しないこと', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');

    const binding = createBindingInfo(input, { propModifiers: ['ro'], statePathName: 'users.*.name-readonly' });
    expect(attachTwowayEventHandler(binding)).toBe(false);
  });

  it('イベントハンドラでstateに値を反映すること', async () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    input.value = 'Alice';
    const addSpy = vi.spyOn(input, 'addEventListener');

    const loopContext = { index: 1 };
    vi.mocked(getLoopContextByNode).mockReturnValue(loopContext as any);

    const state: any = {
      $$setLoopContext: vi.fn((ctx, fn) => fn()),
    };
    const createState = vi.fn((mutability, fn) => fn(state));
    vi.mocked(getStateElementByName).mockReturnValue({ createState } as any);

    const binding = createBindingInfo(input, { statePathName: 'users.*.name-set' });
    attachTwowayEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1] as (event: Event) => void;

    await handler({ target: input } as unknown as Event);

    expect(getLoopContextByNode).toHaveBeenCalledWith(input);
    expect(state.$$setLoopContext).toHaveBeenCalledWith(loopContext, expect.any(Function));
    expect(state['users.*.name-set']).toBe('Alice');
  });

  it('inFilters が適用された値がstateに反映されること', async () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    input.value = '  hello  ';
    const addSpy = vi.spyOn(input, 'addEventListener');

    const loopContext = { index: 0 };
    vi.mocked(getLoopContextByNode).mockReturnValue(loopContext as any);

    const state: any = {
      $$setLoopContext: vi.fn((ctx, fn) => fn()),
    };
    const createState = vi.fn((mutability, fn) => fn(state));
    vi.mocked(getStateElementByName).mockReturnValue({ createState } as any);

    const trimFilter = { filterName: 'trim', args: [] as string[], filterFn: (v: any) => String(v).trim() };
    const ucFilter = { filterName: 'uc', args: [] as string[], filterFn: (v: any) => String(v).toUpperCase() };
    const binding = createBindingInfo(input, {
      statePathName: 'users.*.name-infilter',
      inFilters: [trimFilter, ucFilter],
    });
    attachTwowayEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1] as (event: Event) => void;

    await handler({ target: input } as unknown as Event);

    expect(state['users.*.name-infilter']).toBe('HELLO');
  });

  it('異なる inFilters を持つバインディングは異なるハンドラーキーになること', () => {
    const input1 = document.createElement('input');
    input1.setAttribute('type', 'text');
    const input2 = document.createElement('input');
    input2.setAttribute('type', 'text');

    const addSpy1 = vi.spyOn(input1, 'addEventListener');
    const addSpy2 = vi.spyOn(input2, 'addEventListener');

    const intFilter = { filterName: 'int', args: [] as string[], filterFn: (v: any) => parseInt(v) };
    const binding1 = createBindingInfo(input1, {
      statePathName: 'users.*.age-key',
      inFilters: [intFilter],
    });
    const binding2 = createBindingInfo(input2, {
      statePathName: 'users.*.age-key',
      inFilters: [],
    });

    attachTwowayEventHandler(binding1);
    attachTwowayEventHandler(binding2);

    const handler1 = addSpy1.mock.calls[0]?.[1];
    const handler2 = addSpy2.mock.calls[0]?.[1];
    expect(handler1).not.toBe(handler2);
  });

  it('event.targetがundefinedなら警告して終了すること', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    const addSpy = vi.spyOn(input, 'addEventListener');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const binding = createBindingInfo(input, { statePathName: 'users.*.name-undefined' });
    attachTwowayEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1] as (event: Event) => void;

    handler({ target: undefined } as unknown as Event);
    expect(warnSpy).toHaveBeenCalledWith('[@wcstack/state] event.target is undefined.');
  });

  it('対象プロパティが存在しない場合は警告すること', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    const addSpy = vi.spyOn(input, 'addEventListener');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const binding = createBindingInfo(input, {
      propName: 'value',
      statePathName: 'users.*.name-missing-prop',
    });
    attachTwowayEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1] as (event: Event) => void;

    const div = document.createElement('div');
    handler({ target: div } as unknown as Event);
    expect(warnSpy).toHaveBeenCalledWith(
      '[@wcstack/state] Property "value" does not exist on target element.'
    );
  });

  it('state要素が見つからない場合はraiseErrorを呼ぶこと', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    input.value = 'Bob';
    const addSpy = vi.spyOn(input, 'addEventListener');

    vi.mocked(getStateElementByName).mockReturnValue(null as any);
    vi.mocked(raiseError).mockImplementation(() => {
      throw new Error('state element not found');
    });

    const binding = createBindingInfo(input, { statePathName: 'users.*.name-missing' });
    attachTwowayEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1] as (event: Event) => void;

    expect(() => handler({ target: input } as unknown as Event)).toThrow('state element not found');
    expect(raiseError).toHaveBeenCalledWith(
      'State element with name "default" not found for two-way binding.'
    );
  });

  it('bindingInfoSetが未登録ならdetachはfalseを返すこと', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    const binding = createBindingInfo(input, { statePathName: 'users.*.name-detach-missing-set' });

    attachTwowayEventHandler(binding);
    const eventName = __private__.getEventName(binding);
    const key = __private__.getHandlerKey(binding, eventName);
    __private__.bindingInfoSetByHandlerKey.delete(key);

    expect(detachTwowayEventHandler(binding)).toBe(false);
  });

  it('最後のbindingInfoを削除したらハンドラも削除されること', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    const binding = createBindingInfo(input, { statePathName: 'users.*.name-detach-last' });

    const eventName = __private__.getEventName(binding);
    const key = __private__.getHandlerKey(binding, eventName);
    const handler = __private__.twowayEventHandlerFunction(
      binding.stateName,
      binding.propName,
      binding.statePathName,
      binding.inFilters
    );
    __private__.handlerByHandlerKey.set(key, handler);
    const bindingInfoSet = new Set([binding]);
    __private__.bindingInfoSetByHandlerKey.set(key, bindingInfoSet);

    expect(bindingInfoSet.size).toBe(1);

    expect(detachTwowayEventHandler(binding)).toBe(true);
    expect(bindingInfoSet.size).toBe(0);
    expect(__private__.handlerByHandlerKey.has(key)).toBe(false);
    expect(__private__.bindingInfoSetByHandlerKey.has(key)).toBe(false);
  });

  it('同一キーのbindingが残る場合はハンドラを保持すること', () => {
    const input1 = document.createElement('input');
    input1.setAttribute('type', 'text');
    const input2 = document.createElement('input');
    input2.setAttribute('type', 'text');

    const binding1 = createBindingInfo(input1, { statePathName: 'users.*.name-keep' });
    const binding2 = createBindingInfo(input2, { statePathName: 'users.*.name-keep' });

    attachTwowayEventHandler(binding1);
    attachTwowayEventHandler(binding2);

    const eventName = __private__.getEventName(binding1);
    const key = __private__.getHandlerKey(binding1, eventName);
    expect(detachTwowayEventHandler(binding1)).toBe(true);
    expect(__private__.handlerByHandlerKey.has(key)).toBe(true);
    expect(__private__.bindingInfoSetByHandlerKey.has(key)).toBe(true);
  });
});

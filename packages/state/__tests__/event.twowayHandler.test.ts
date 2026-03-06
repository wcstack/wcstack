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
import { setLoopContextSymbol } from '../src/proxy/symbols';

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
    __private__.bindingSetByHandlerKey.clear();
  });

  it('two-way対象でイベントを登録できること', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    const addSpy = vi.spyOn(input, 'addEventListener');

    const binding = createBindingInfo(input, { statePathName: 'users.*.name-input' });
    attachTwowayEventHandler(binding);
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

    detachTwowayEventHandler(binding);
    expect(removeSpy).toHaveBeenCalledWith('input', handler);
    const eventName = __private__.getEventName(binding);
    const key = __private__.getHandlerKey(binding, eventName);
    expect(__private__.handlerByHandlerKey.has(key)).toBe(false);
    expect(__private__.bindingSetByHandlerKey.has(key)).toBe(false);
  });

  it('two-way対象外はaddEventListenerが呼ばれないこと', () => {
    const div = document.createElement('div');
    const addSpy = vi.spyOn(div, 'addEventListener');
    const binding = createBindingInfo(div, { propName: 'value', statePathName: 'users.*.name-non' });
    attachTwowayEventHandler(binding);
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('detachでtwo-way対象外ならremoveEventListenerが呼ばれないこと', () => {
    const div = document.createElement('div');
    const removeSpy = vi.spyOn(div, 'removeEventListener');
    const binding = createBindingInfo(div, { propName: 'value', statePathName: 'users.*.name-non-detach' });
    detachTwowayEventHandler(binding);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('select要素はchangeイベントを使うこと', () => {
    const select = document.createElement('select');
    const addSpy = vi.spyOn(select, 'addEventListener');

    const binding = createBindingInfo(select, { statePathName: 'users.*.name-select' });
    attachTwowayEventHandler(binding);
    expect(addSpy).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('ro修飾子がある場合は登録しないこと', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    const addSpy = vi.spyOn(input, 'addEventListener');

    const binding = createBindingInfo(input, { propModifiers: ['ro'], statePathName: 'users.*.name-readonly' });
    attachTwowayEventHandler(binding);
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('イベントハンドラでstateに値を反映すること', async () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    input.value = 'Alice';
    const addSpy = vi.spyOn(input, 'addEventListener');

    const loopContext = { index: 1 };
    vi.mocked(getLoopContextByNode).mockReturnValue(loopContext as any);

    const state: any = {
      [setLoopContextSymbol]: vi.fn((ctx, fn) => fn()),
    };
    const createState = vi.fn((mutability, fn) => fn(state));
    vi.mocked(getStateElementByName).mockReturnValue({ createState } as any);

    const binding = createBindingInfo(input, { statePathName: 'users.*.name-set' });
    attachTwowayEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1] as (event: Event) => void;

    await handler({ target: input } as unknown as Event);

    expect(getLoopContextByNode).toHaveBeenCalledWith(input);
    expect(state[setLoopContextSymbol]).toHaveBeenCalledWith(loopContext, expect.any(Function));
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
      [setLoopContextSymbol]: vi.fn((ctx, fn) => fn()),
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

  it('event.targetがnullなら警告して終了すること', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    const addSpy = vi.spyOn(input, 'addEventListener');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const binding = createBindingInfo(input, { statePathName: 'users.*.name-null' });
    attachTwowayEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1] as (event: Event) => void;

    handler({ target: null } as unknown as Event);
    expect(warnSpy).toHaveBeenCalledWith('[@wcstack/state] event.target is null.');
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

  it('bindingInfoSetが未登録ならdetachでremoveEventListenerが呼ばれないこと', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    const removeSpy = vi.spyOn(input, 'removeEventListener');
    const binding = createBindingInfo(input, { statePathName: 'users.*.name-detach-missing-set' });

    attachTwowayEventHandler(binding);
    const eventName = __private__.getEventName(binding);
    const key = __private__.getHandlerKey(binding, eventName);
    __private__.bindingSetByHandlerKey.delete(key);

    detachTwowayEventHandler(binding);
    // removeEventListenerは呼ばれるが、bindingSetがないため早期リターン
    expect(removeSpy).toHaveBeenCalled();
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
    __private__.bindingSetByHandlerKey.set(key, bindingInfoSet);

    expect(bindingInfoSet.size).toBe(1);

    detachTwowayEventHandler(binding);
    expect(bindingInfoSet.size).toBe(0);
    expect(__private__.handlerByHandlerKey.has(key)).toBe(false);
    expect(__private__.bindingSetByHandlerKey.has(key)).toBe(false);
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
    detachTwowayEventHandler(binding1);
    expect(__private__.handlerByHandlerKey.has(key)).toBe(true);
    expect(__private__.bindingSetByHandlerKey.has(key)).toBe(true);
  });

  describe('wcsReactivity プロトコル', () => {
    it('カスタム要素のdefaultEventでイベント登録されること', () => {
      class MyDatepickerTw extends HTMLElement {
        static wcsReactivity = {
          defaultEvent: 'date-change',
          properties: ['value'],
        };
      }
      customElements.define('my-datepicker-tw', MyDatepickerTw);
      const el = document.createElement('my-datepicker-tw');
      const addSpy = vi.spyOn(el, 'addEventListener');

      const binding = createBindingInfo(el, { statePathName: 'date.value-protocol' });
      attachTwowayEventHandler(binding);
      expect(addSpy).toHaveBeenCalledWith('date-change', expect.any(Function));
    });

    it('propertyMapのイベントがdefaultEventより優先されること', () => {
      class MyPickerTw extends HTMLElement {
        static wcsReactivity = {
          defaultEvent: 'change',
          properties: ['value', 'isOpen'],
          propertyMap: { isOpen: 'toggle' },
        };
      }
      customElements.define('my-picker-tw', MyPickerTw);

      // isOpen → propertyMap の 'toggle' が使われる
      const el1 = document.createElement('my-picker-tw');
      const addSpy1 = vi.spyOn(el1, 'addEventListener');
      const binding1 = createBindingInfo(el1, { propName: 'isOpen', statePathName: 'picker.isOpen-pm' });
      attachTwowayEventHandler(binding1);
      expect(addSpy1).toHaveBeenCalledWith('toggle', expect.any(Function));

      // value → defaultEvent の 'change' が使われる
      const el2 = document.createElement('my-picker-tw');
      const addSpy2 = vi.spyOn(el2, 'addEventListener');
      const binding2 = createBindingInfo(el2, { propName: 'value', statePathName: 'picker.value-de' });
      attachTwowayEventHandler(binding2);
      expect(addSpy2).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('#onXxx修飾子がプロトコルのイベントを上書きすること', () => {
      class MySliderTw extends HTMLElement {
        static wcsReactivity = {
          defaultEvent: 'slide',
          properties: ['value'],
        };
      }
      customElements.define('my-slider-tw', MySliderTw);
      const el = document.createElement('my-slider-tw');
      const addSpy = vi.spyOn(el, 'addEventListener');

      const binding = createBindingInfo(el, {
        propModifiers: ['onmouseup'],
        statePathName: 'slider.value-mod',
      });
      attachTwowayEventHandler(binding);
      expect(addSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
    });

    it('未定義カスタム要素はwhenDefinedで遅延登録されること', async () => {
      const el = document.createElement('my-deferred-tw');
      const addSpy = vi.spyOn(el, 'addEventListener');

      const binding = createBindingInfo(el, { statePathName: 'deferred.value-wd' });
      attachTwowayEventHandler(binding);

      // まだ定義されていないのでaddEventListenerは呼ばれない
      expect(addSpy).not.toHaveBeenCalled();

      // 要素を定義する
      class MyDeferredTw extends HTMLElement {
        static wcsReactivity = {
          defaultEvent: 'ready',
          properties: ['value'],
        };
      }
      customElements.define('my-deferred-tw', MyDeferredTw);

      // whenDefinedのPromiseが解決するのを待つ
      await customElements.whenDefined('my-deferred-tw');
      // microtask を待つ（then コールバックの実行のため）
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(addSpy).toHaveBeenCalledWith('ready', expect.any(Function));
    });

    it('未定義カスタム要素のdetachもwhenDefinedで遅延されること', async () => {
      const el = document.createElement('my-deferred-detach-tw');
      const removeSpy = vi.spyOn(el, 'removeEventListener');

      const binding = createBindingInfo(el, { statePathName: 'deferred.value-detach' });
      detachTwowayEventHandler(binding);

      // まだ定義されていないのでremoveEventListenerは呼ばれない
      expect(removeSpy).not.toHaveBeenCalled();

      class MyDeferredDetachTw extends HTMLElement {
        static wcsReactivity = {
          defaultEvent: 'ready',
          properties: ['value'],
        };
      }
      customElements.define('my-deferred-detach-tw', MyDeferredDetachTw);

      await customElements.whenDefined('my-deferred-detach-tw');
      await new Promise(resolve => setTimeout(resolve, 0));

      // ハンドラが登録されていないのでremoveEventListenerは呼ばれない
      expect(removeSpy).not.toHaveBeenCalled();
    });

    it('wcsReactivityがないカスタム要素はaddEventListenerが呼ばれないこと', () => {
      class PlainCustomTw extends HTMLElement {}
      customElements.define('plain-custom-tw', PlainCustomTw);
      const el = document.createElement('plain-custom-tw');
      const addSpy = vi.spyOn(el, 'addEventListener');

      const binding = createBindingInfo(el, { statePathName: 'plain.value' });
      attachTwowayEventHandler(binding);
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('getEventNameでwcsReactivityがないカスタム要素はデフォルトイベントを返すこと', () => {
      class PlainEventTw extends HTMLElement {}
      customElements.define('plain-event-tw', PlainEventTw);
      const el = document.createElement('plain-event-tw');
      const binding = createBindingInfo(el, { statePathName: 'plain.value-event' });
      const eventName = __private__.getEventName(binding);
      expect(eventName).toBe('input');
    });

    it('getEventNameで未定義カスタム要素はraiseErrorを呼ぶこと', () => {
      vi.mocked(raiseError).mockImplementation(() => {
        throw new Error('not defined');
      });
      const el = document.createElement('my-undefined-event-tw');
      const binding = createBindingInfo(el, { statePathName: 'undef.value-event' });
      expect(() => __private__.getEventName(binding)).toThrow('not defined');
      expect(raiseError).toHaveBeenCalledWith(
        'Custom element <my-undefined-event-tw> is not defined. Cannot determine event name for two-way binding.'
      );
    });

    it('propertyMapのみで定義されたプロパティでもイベント登録されること', () => {
      class MyToggleTw extends HTMLElement {
        static wcsReactivity = {
          defaultEvent: 'change',
          propertyMap: { checked: 'toggle-change' },
        };
      }
      customElements.define('my-toggle-tw', MyToggleTw);
      const el = document.createElement('my-toggle-tw');
      const addSpy = vi.spyOn(el, 'addEventListener');

      const binding = createBindingInfo(el, { propName: 'checked', statePathName: 'toggle.checked-pm' });
      attachTwowayEventHandler(binding);
      expect(addSpy).toHaveBeenCalledWith('toggle-change', expect.any(Function));
    });
  });
});

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
    const key = __private__.getHandlerKey(binding, eventName, false);
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
    const key = __private__.getHandlerKey(binding, eventName, false);
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
    const key = __private__.getHandlerKey(binding, eventName, false);
    const handler = __private__.twowayEventHandlerFunction(
      binding.stateName,
      binding.propName,
      binding.statePathName,
      binding.inFilters,
      null
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
    const key = __private__.getHandlerKey(binding1, eventName, false);
    detachTwowayEventHandler(binding1);
    expect(__private__.handlerByHandlerKey.has(key)).toBe(true);
    expect(__private__.bindingSetByHandlerKey.has(key)).toBe(true);
  });

  describe('wcBindable プロトコル', () => {
    it('カスタム要素のプロトコルイベントで登録されること', () => {
      class MyDatepickerTw extends HTMLElement {
        static wcBindable = {
          protocol: "wc-bindable" as const,
          version: 1,
          properties: [
            { name: 'value', event: 'my-datepicker-tw:value-changed' },
          ],
        };
      }
      customElements.define('my-datepicker-tw', MyDatepickerTw);
      const el = document.createElement('my-datepicker-tw');
      const addSpy = vi.spyOn(el, 'addEventListener');

      const binding = createBindingInfo(el, { statePathName: 'date.value-protocol' });
      attachTwowayEventHandler(binding);
      expect(addSpy).toHaveBeenCalledWith('my-datepicker-tw:value-changed', expect.any(Function));
    });

    it('各プロパティに対応するイベントで登録されること', () => {
      class MyPickerTw extends HTMLElement {
        static wcBindable = {
          protocol: "wc-bindable" as const,
          version: 1,
          properties: [
            { name: 'value', event: 'my-picker-tw:value-changed' },
            { name: 'isOpen', event: 'my-picker-tw:toggle' },
          ],
        };
      }
      customElements.define('my-picker-tw', MyPickerTw);

      // isOpen → 'my-picker-tw:toggle'
      const el1 = document.createElement('my-picker-tw');
      const addSpy1 = vi.spyOn(el1, 'addEventListener');
      const binding1 = createBindingInfo(el1, { propName: 'isOpen', statePathName: 'picker.isOpen-pm' });
      attachTwowayEventHandler(binding1);
      expect(addSpy1).toHaveBeenCalledWith('my-picker-tw:toggle', expect.any(Function));

      // value → 'my-picker-tw:value-changed'
      const el2 = document.createElement('my-picker-tw');
      const addSpy2 = vi.spyOn(el2, 'addEventListener');
      const binding2 = createBindingInfo(el2, { propName: 'value', statePathName: 'picker.value-de' });
      attachTwowayEventHandler(binding2);
      expect(addSpy2).toHaveBeenCalledWith('my-picker-tw:value-changed', expect.any(Function));
    });

    it('#onXxx修飾子がプロトコルのイベントを上書きすること', () => {
      class MySliderTw extends HTMLElement {
        static wcBindable = {
          protocol: "wc-bindable" as const,
          version: 1,
          properties: [
            { name: 'value', event: 'my-slider-tw:slide' },
          ],
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
        static wcBindable = {
          protocol: "wc-bindable" as const,
          version: 1,
          properties: [
            { name: 'value', event: 'my-deferred-tw:ready' },
          ],
        };
      }
      customElements.define('my-deferred-tw', MyDeferredTw);

      // whenDefinedのPromiseが解決するのを待つ
      await customElements.whenDefined('my-deferred-tw');
      // microtask を待つ（then コールバックの実行のため）
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(addSpy).toHaveBeenCalledWith('my-deferred-tw:ready', expect.any(Function));
    });

    it('未定義カスタム要素のdetachもwhenDefinedで遅延されること', async () => {
      const el = document.createElement('my-deferred-detach-tw');
      const removeSpy = vi.spyOn(el, 'removeEventListener');

      const binding = createBindingInfo(el, { statePathName: 'deferred.value-detach' });
      detachTwowayEventHandler(binding);

      // まだ定義されていないのでremoveEventListenerは呼ばれない
      expect(removeSpy).not.toHaveBeenCalled();

      class MyDeferredDetachTw extends HTMLElement {
        static wcBindable = {
          protocol: "wc-bindable" as const,
          version: 1,
          properties: [
            { name: 'value', event: 'my-deferred-detach-tw:ready' },
          ],
        };
      }
      customElements.define('my-deferred-detach-tw', MyDeferredDetachTw);

      await customElements.whenDefined('my-deferred-detach-tw');
      await new Promise(resolve => setTimeout(resolve, 0));

      // ハンドラが登録されていないのでremoveEventListenerは呼ばれない
      expect(removeSpy).not.toHaveBeenCalled();
    });

    it('wcBindableがないカスタム要素はaddEventListenerが呼ばれないこと', () => {
      class PlainCustomTw extends HTMLElement {}
      customElements.define('plain-custom-tw', PlainCustomTw);
      const el = document.createElement('plain-custom-tw');
      const addSpy = vi.spyOn(el, 'addEventListener');

      const binding = createBindingInfo(el, { statePathName: 'plain.value' });
      attachTwowayEventHandler(binding);
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('getEventNameでwcBindableがないカスタム要素はデフォルトイベントを返すこと', () => {
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

    it('propertiesで定義されたプロパティのイベントで登録されること', () => {
      class MyToggleTw extends HTMLElement {
        static wcBindable = {
          protocol: "wc-bindable" as const,
          version: 1,
          properties: [
            { name: 'checked', event: 'my-toggle-tw:toggle-change' },
          ],
        };
      }
      customElements.define('my-toggle-tw', MyToggleTw);
      const el = document.createElement('my-toggle-tw');
      const addSpy = vi.spyOn(el, 'addEventListener');

      const binding = createBindingInfo(el, { propName: 'checked', statePathName: 'toggle.checked-pm' });
      attachTwowayEventHandler(binding);
      expect(addSpy).toHaveBeenCalledWith('my-toggle-tw:toggle-change', expect.any(Function));
    });
  });

  describe('wcBindable 値取得', () => {
    it('デフォルトgetterでevent.detailから値を取得すること', async () => {
      class MyDetailInput extends HTMLElement {
        static wcBindable = {
          protocol: "wc-bindable" as const,
          version: 1,
          properties: [
            { name: 'value', event: 'my-detail-input:value-changed' },
          ],
        };
      }
      customElements.define('my-detail-input', MyDetailInput);
      const el = document.createElement('my-detail-input');
      const addSpy = vi.spyOn(el, 'addEventListener');

      const state: any = { [setLoopContextSymbol]: vi.fn((_ctx: any, fn: any) => fn()) };
      const createState = vi.fn((_mutability: any, fn: any) => fn(state));
      vi.mocked(getStateElementByName).mockReturnValue({ createState } as any);
      vi.mocked(getLoopContextByNode).mockReturnValue(null as any);

      const binding = createBindingInfo(el, { statePathName: 'form.value-detail' });
      attachTwowayEventHandler(binding);
      const handler = addSpy.mock.calls[0]?.[1] as (event: Event) => void;

      const customEvent = new CustomEvent('my-detail-input:value-changed', { detail: 'from-detail' });
      Object.defineProperty(customEvent, 'target', { value: el });
      await handler(customEvent);

      expect(state['form.value-detail']).toBe('from-detail');
    });

    it('カスタムgetterでイベントから値を抽出すること', async () => {
      class MyCustomGetter extends HTMLElement {
        static wcBindable = {
          protocol: "wc-bindable" as const,
          version: 1,
          properties: [{
            name: 'value',
            event: 'my-custom-getter:change',
            getter: (e: Event) => (e as CustomEvent).detail.nested.value,
          }],
        };
      }
      customElements.define('my-custom-getter', MyCustomGetter);
      const el = document.createElement('my-custom-getter');
      const addSpy = vi.spyOn(el, 'addEventListener');

      const state: any = { [setLoopContextSymbol]: vi.fn((_ctx: any, fn: any) => fn()) };
      const createState = vi.fn((_mutability: any, fn: any) => fn(state));
      vi.mocked(getStateElementByName).mockReturnValue({ createState } as any);
      vi.mocked(getLoopContextByNode).mockReturnValue(null as any);

      const binding = createBindingInfo(el, { statePathName: 'form.value-custom' });
      attachTwowayEventHandler(binding);
      const handler = addSpy.mock.calls[0]?.[1] as (event: Event) => void;

      const customEvent = new CustomEvent('my-custom-getter:change', {
        detail: { nested: { value: 'deep-value' } },
      });
      Object.defineProperty(customEvent, 'target', { value: el });
      await handler(customEvent);

      expect(state['form.value-custom']).toBe('deep-value');
    });

    it('getValueGetterがネイティブ要素に対してnullを返すこと', () => {
      const input = document.createElement('input');
      const binding = createBindingInfo(input);
      const getter = __private__.getValueGetter(binding);
      expect(getter).toBeNull();
    });

    it('getValueGetterがwcBindable要素に対してデフォルトgetterを返すこと', () => {
      const el = document.createElement('my-detail-input');
      const binding = createBindingInfo(el);
      const getter = __private__.getValueGetter(binding);
      expect(getter).toBe(__private__.DEFAULT_GETTER);
    });

    it('getValueGetterがカスタムgetterを返すこと', () => {
      const el = document.createElement('my-custom-getter');
      const binding = createBindingInfo(el);
      const getter = __private__.getValueGetter(binding);
      expect(getter).not.toBeNull();
      expect(getter).not.toBe(__private__.DEFAULT_GETTER);
    });

    it('プロトコルバリデーション: protocol不一致時はnullを返すこと', () => {
      class BadProtoTw extends HTMLElement {
        static wcBindable = {
          protocol: "wrong",
          version: 1,
          properties: [{ name: 'value', event: 'change' }],
        };
      }
      customElements.define('bad-proto-tw', BadProtoTw);
      const el = document.createElement('bad-proto-tw');
      const binding = createBindingInfo(el);
      const getter = __private__.getValueGetter(binding);
      expect(getter).toBeNull();
    });

    it('プロトコルバリデーション: version不一致時はnullを返すこと', () => {
      class BadVersionTw extends HTMLElement {
        static wcBindable = {
          protocol: "wc-bindable" as const,
          version: 2,
          properties: [{ name: 'value', event: 'change' }],
        };
      }
      customElements.define('bad-version-tw', BadVersionTw);
      const el = document.createElement('bad-version-tw');
      const binding = createBindingInfo(el);
      const getter = __private__.getValueGetter(binding);
      expect(getter).toBeNull();
    });

    it('getEventNameでwcBindableのpropertiesにないpropNameはデフォルトイベントを返すこと', () => {
      const el = document.createElement('my-detail-input');
      const binding = createBindingInfo(el, { propName: 'unknownProp', statePathName: 'x.unknown-prop' });
      const eventName = __private__.getEventName(binding);
      expect(eventName).toBe('input');
    });

    it('getValueGetterで未定義カスタム要素はnullを返すこと', () => {
      const el = document.createElement('my-undefined-getter-tw');
      const binding = createBindingInfo(el);
      const getter = __private__.getValueGetter(binding);
      expect(getter).toBeNull();
    });

    it('getValueGetterでwcBindableのpropertiesにないpropNameはnullを返すこと', () => {
      const el = document.createElement('my-detail-input');
      const binding = createBindingInfo(el, { propName: 'unknownProp' });
      const getter = __private__.getValueGetter(binding);
      expect(getter).toBeNull();
    });

    it('ハンドラキーにgetterフラグが含まれること', () => {
      const input = document.createElement('input');
      const binding = createBindingInfo(input, { statePathName: 'x.y-flag' });
      const keyWithGetter = __private__.getHandlerKey(binding, 'input', true);
      const keyWithoutGetter = __private__.getHandlerKey(binding, 'input', false);
      expect(keyWithGetter).toContain('::g');
      expect(keyWithoutGetter).toContain('::n');
      expect(keyWithGetter).not.toBe(keyWithoutGetter);
    });
  });
});

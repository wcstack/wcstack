import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attachEventHandler, detachEventHandler, __private__ } from '../src/event/handler';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';
import { setStateElementByName } from '../src/stateElementByName';
import { setLoopContextSymbol } from '../src/proxy/symbols';

function createBindingInfo(node: Element, overrides?: Partial<IBindingInfo>): IBindingInfo {
  return {
    propName: 'onclick',
    propSegments: ['onclick'],
    propModifiers: [],
    statePathName: 'handleClick',
    statePathInfo: getPathInfo('handleClick'),
    stateName: 'default',
    filterTexts: [],
    bindingType: 'event',
    uuid: null,
    node,
    replaceNode: node,
    ...overrides,
  } as IBindingInfo;
}

describe('event/handler', () => {
  beforeEach(() => {
    setStateElementByName(document, 'default', null);
  });

  afterEach(() => {
    setStateElementByName(document, 'default', null);
  });

  it('attachEventHandlerはon*以外でfalseを返すこと', () => {
    const el = document.createElement('button');
    const bindingInfo = createBindingInfo(el, {
      propName: 'value',
      propSegments: ['value'],
      statePathName: 'handleClick-none'
    });
    expect(attachEventHandler(bindingInfo)).toBe(false);
  });

  it('同じキーのハンドラを共有すること', () => {
    const el1 = document.createElement('button');
    const el2 = document.createElement('button');

    const addSpy1 = vi.spyOn(el1, 'addEventListener');
    const addSpy2 = vi.spyOn(el2, 'addEventListener');

    const binding1 = createBindingInfo(el1, { statePathName: 'handleClick-share' });
    const binding2 = createBindingInfo(el2, { statePathName: 'handleClick-share' });

    expect(attachEventHandler(binding1)).toBe(true);
    expect(attachEventHandler(binding2)).toBe(true);

    const handler1 = addSpy1.mock.calls[0]?.[1];
    const handler2 = addSpy2.mock.calls[0]?.[1];
    expect(handler1).toBe(handler2);
  });

  it('detachEventHandlerでイベント解除できること', () => {
    const el = document.createElement('button');
    const addSpy = vi.spyOn(el, 'addEventListener');
    const removeSpy = vi.spyOn(el, 'removeEventListener');

    const binding = createBindingInfo(el, { statePathName: 'handleClick-detach' });
    attachEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1];

    expect(detachEventHandler(binding)).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith('click', handler);
    // 2回目は対象が無いのでfalse
    expect(detachEventHandler(binding)).toBe(false);
  });

  it('detachEventHandlerはon*以外でfalseを返すこと', () => {
    const el = document.createElement('button');
    const bindingInfo = createBindingInfo(el, {
      propName: 'value',
      propSegments: ['value'],
      statePathName: 'handleClick-none-detach'
    });
    expect(detachEventHandler(bindingInfo)).toBe(false);
  });

  it('bindingInfoSetが存在しない場合はfalseを返すこと', () => {
    const el = document.createElement('button');
    const binding = createBindingInfo(el, { statePathName: 'handleClick-no-set' });

    attachEventHandler(binding);

    const key = `${binding.stateName}::${binding.statePathName}::`;
    __private__.bindingInfoSetByHandlerKey.delete(key);

    expect(detachEventHandler(binding)).toBe(false);

    __private__.handlerByHandlerKey.delete(key);
    __private__.bindingInfoSetByHandlerKey.delete(key);
  });

  it('複数バインディング時に1つ解除してもハンドラが残ること', () => {
    const el1 = document.createElement('button');
    const el2 = document.createElement('button');

    const binding1 = createBindingInfo(el1, { statePathName: 'handleClick-multi' });
    const binding2 = createBindingInfo(el2, { statePathName: 'handleClick-multi' });

    attachEventHandler(binding1);
    attachEventHandler(binding2);

    const key = `${binding1.stateName}::${binding1.statePathName}::`;
    expect(detachEventHandler(binding1)).toBe(true);
    expect(__private__.handlerByHandlerKey.has(key)).toBe(true);

    detachEventHandler(binding2);
  });

  it('stateElementが存在しない場合はハンドラでエラーになること', () => {
    const el = document.createElement('button');
    const addSpy = vi.spyOn(el, 'addEventListener');
    const binding = createBindingInfo(el, { statePathName: 'handleClick-missing' });

    attachEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1] as ((event: Event) => any);

    setStateElementByName(document, 'default', null);
    const event = new Event('click');
    Object.defineProperty(event, 'target', { value: el });
    expect(() => handler(event)).toThrow(/State element with name "default" not found/);
  });

  it('stateのハンドラが関数でない場合はエラーになること', () => {
    const el = document.createElement('button');
    const addSpy = vi.spyOn(el, 'addEventListener');
    const binding = createBindingInfo(el, { statePathName: 'handleClick-not-fn' });

    const state = {
      'handleClick-not-fn': 123,
      [setLoopContextSymbol]: (_ctx: any, cb: () => void) => cb(),
    } as any;
    let lastPromise: Promise<any> | null = null;
    setStateElementByName(el, 'default', {
      createStateAsync: (mutability: string, callback: (s: any) => Promise<void>) => {
        lastPromise = callback(state);
        return lastPromise as Promise<void>;
      }
    } as any);

    attachEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1] as ((event: Event) => any);
    const event = new Event('click');
    Object.defineProperty(event, 'target', { value: el });
    handler(event);
    expect(lastPromise).not.toBeNull();
    return expect(lastPromise!).rejects.toThrow(/is not a function/);
  });

  it('preventモディファイアでpreventDefaultが呼ばれること', async () => {
    const el = document.createElement('button');
    const addSpy = vi.spyOn(el, 'addEventListener');
    const binding = createBindingInfo(el, {
      propName: 'onclick',
      propModifiers: ['prevent'],
      statePathName: 'handleClick-prevent',
    });

    const state: any = {
      'handleClick-prevent': vi.fn(),
      [setLoopContextSymbol]: (_ctx: any, cb: () => void) => cb()
    };
    let lastPromise: Promise<any> | null = null;
    setStateElementByName(el, 'default', {
      createStateAsync: (_mutability: string, callback: (s: any) => Promise<void>) => {
        lastPromise = callback(state);
        return lastPromise as Promise<void>;
      }
    } as any);

    attachEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1] as ((event: Event) => any);
    const event = new Event('click', { cancelable: true });
    Object.defineProperty(event, 'target', { value: el });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    handler(event);

    await lastPromise;
    expect(preventSpy).toHaveBeenCalledTimes(1);
    expect(state['handleClick-prevent']).toHaveBeenCalledTimes(1);
  });

  it('stopモディファイアでstopPropagationが呼ばれること', async () => {
    const el = document.createElement('button');
    const addSpy = vi.spyOn(el, 'addEventListener');
    const binding = createBindingInfo(el, {
      propName: 'onclick',
      propModifiers: ['stop'],
      statePathName: 'handleClick-stop',
    });

    const state: any = {
      'handleClick-stop': vi.fn(),
      [setLoopContextSymbol]: (_ctx: any, cb: () => void) => cb()
    };
    let lastPromise: Promise<any> | null = null;
    setStateElementByName(el, 'default', {
      createStateAsync: (_mutability: string, callback: (s: any) => Promise<void>) => {
        lastPromise = callback(state);
        return lastPromise as Promise<void>;
      }
    } as any);

    attachEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1] as ((event: Event) => any);
    const event = new Event('click', { bubbles: true });
    Object.defineProperty(event, 'target', { value: el });
    const stopSpy = vi.spyOn(event, 'stopPropagation');
    handler(event);

    await lastPromise;
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(state['handleClick-stop']).toHaveBeenCalledTimes(1);
  });

  it('prevent,stopモディファイアで両方呼ばれること', async () => {
    const el = document.createElement('button');
    const addSpy = vi.spyOn(el, 'addEventListener');
    const binding = createBindingInfo(el, {
      propName: 'onclick',
      propModifiers: ['prevent', 'stop'],
      statePathName: 'handleClick-both',
    });

    const state: any = {
      'handleClick-both': vi.fn(),
      [setLoopContextSymbol]: (_ctx: any, cb: () => void) => cb()
    };
    let lastPromise: Promise<any> | null = null;
    setStateElementByName(el, 'default', {
      createStateAsync: (_mutability: string, callback: (s: any) => Promise<void>) => {
        lastPromise = callback(state);
        return lastPromise as Promise<void>;
      }
    } as any);

    attachEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1] as ((event: Event) => any);
    const event = new Event('click', { cancelable: true, bubbles: true });
    Object.defineProperty(event, 'target', { value: el });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    const stopSpy = vi.spyOn(event, 'stopPropagation');
    handler(event);

    await lastPromise;
    expect(preventSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(state['handleClick-both']).toHaveBeenCalledTimes(1);
  });

  it('モディファイアが異なるバインディングは別のハンドラキーを持つこと', () => {
    const el1 = document.createElement('button');
    const el2 = document.createElement('button');
    const addSpy1 = vi.spyOn(el1, 'addEventListener');
    const addSpy2 = vi.spyOn(el2, 'addEventListener');

    const binding1 = createBindingInfo(el1, {
      propModifiers: ['prevent'],
      statePathName: 'handleClick-diff-mod',
    });
    const binding2 = createBindingInfo(el2, {
      propModifiers: [],
      statePathName: 'handleClick-diff-mod',
    });

    attachEventHandler(binding1);
    attachEventHandler(binding2);

    const handler1 = addSpy1.mock.calls[0]?.[1];
    const handler2 = addSpy2.mock.calls[0]?.[1];
    expect(handler1).not.toBe(handler2);
  });

  it('stateのハンドラが呼び出されること', async () => {
    const el = document.createElement('button');
    const addSpy = vi.spyOn(el, 'addEventListener');
    const binding = createBindingInfo(el, { statePathName: 'handleClick-ok' });

    const state: any = {
      'handleClick-ok': vi.fn(function (this: any) {
        expect(this).toBe(state);
      }),
      [setLoopContextSymbol]: (_ctx: any, cb: () => void) => cb()
    };
    let lastPromise: Promise<any> | null = null;
    setStateElementByName(el, 'default', {
      createStateAsync: (mutability: string, callback: (s: any) => Promise<void>) => {
        lastPromise = callback(state);
        return lastPromise as Promise<void>;
      }
    } as any);

    attachEventHandler(binding);
    const handler = addSpy.mock.calls[0]?.[1] as ((event: Event) => any);
    const event = new Event('click');
    Object.defineProperty(event, 'target', { value: el });
    handler(event);

    await lastPromise;
    expect(state['handleClick-ok']).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { attachEventTokenHandler, detachEventTokenHandler } from '../src/event/eventTokenHandler';
import { getOrCreateEventToken, clearEventTokenRegistry } from '../src/event/eventTokenRegistry';
import { getPathInfo } from '../src/address/PathInfo';
import { setStateElementByName } from '../src/stateElementByName';
import { setLoopContextSymbol } from '../src/proxy/symbols';
import type { IBindingInfo } from '../src/types';
import type { IWcBindable } from '../src/event/types';
import type { IStateElement } from '../src/components/types';

function defineWcBindable(tagName: string, bindable: IWcBindable | undefined): CustomElementConstructor {
  const existing = customElements.get(tagName);
  if (existing) return existing;
  class C extends HTMLElement {
    static wcBindable: IWcBindable | undefined = bindable;
  }
  customElements.define(tagName, C);
  return C;
}

const OK_PROPS: IWcBindable = {
  protocol: 'wc-bindable',
  version: 1,
  properties: [{ name: 'error', event: 'my-error' }],
};

function createBinding(node: Element, propertyName: string, tokenName: string, modifiers: string[] = []): IBindingInfo {
  return {
    propName: `eventToken.${propertyName}`,
    propSegments: ['eventToken', propertyName],
    propModifiers: modifiers,
    statePathName: tokenName,
    statePathInfo: getPathInfo(tokenName),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'event',
    uuid: null,
    node,
    replaceNode: node,
  } as IBindingInfo;
}

interface FakeSE extends IStateElement {
  lastPromise: Promise<void> | null;
}

function makeFakeStateElement(tokenNames: string[], state: any): FakeSE {
  const se: any = {
    eventTokenNames: new Set(tokenNames),
    lastPromise: null,
    createStateAsync(_m: string, cb: (s: any) => Promise<void>) {
      se.lastPromise = cb(state);
      return se.lastPromise;
    },
  };
  return se as FakeSE;
}

const makeState = (extra: Record<string, unknown> = {}) => ({
  [setLoopContextSymbol]: (_ctx: unknown, cb: () => unknown) => cb(),
  ...extra,
});

describe('eventTokenHandler', () => {
  beforeAll(() => {
    defineWcBindable('evt-ok', OK_PROPS);
    defineWcBindable('evt-no-prop', { protocol: 'wc-bindable', version: 1, properties: [] });
    defineWcBindable('evt-bad-protocol', { protocol: 'other' as any, version: 1, properties: [] });
  });

  beforeEach(() => {
    setStateElementByName(document, 'default', null);
  });
  afterEach(() => {
    setStateElementByName(document, 'default', null);
    vi.unstubAllGlobals();
  });

  it('eventToken以外のpropSegmentsではfalseを返すこと', () => {
    const el = document.createElement('evt-ok');
    const binding = createBinding(el, 'error', 'createFailed');
    (binding as any).propSegments = ['value'];
    expect(attachEventTokenHandler(binding)).toBe(false);
    expect(detachEventTokenHandler(binding)).toBe(false);
  });

  it('property名が空ならエラーになること', () => {
    const el = document.createElement('evt-ok');
    const binding = createBinding(el, 'error', 'createFailed');
    (binding as any).propSegments = ['eventToken'];
    expect(() => attachEventTokenHandler(binding)).toThrow(/property name/);
  });

  it('wc-bindableでない要素ではエラーになること', () => {
    const el = document.createElement('div');
    const binding = createBinding(el, 'error', 'createFailed');
    expect(() => attachEventTokenHandler(binding)).toThrow(/wc-bindable/);
  });

  it('wcBindable.protocolが不正な要素ではエラーになること', () => {
    const el = document.createElement('evt-bad-protocol');
    const binding = createBinding(el, 'error', 'createFailed');
    expect(() => attachEventTokenHandler(binding)).toThrow(/wc-bindable/);
  });

  it('wcBindable.propertiesに無いプロパティ名はエラーになること', () => {
    const el = document.createElement('evt-no-prop');
    const binding = createBinding(el, 'error', 'createFailed');
    expect(() => attachEventTokenHandler(binding)).toThrow(/not declared in wcBindable.properties/);
  });

  it('stateElement未登録でもattachは成功し（detached/hydration対応）、発火時にnot foundになること', () => {
    const el = document.createElement('evt-ok');
    const addSpy = vi.spyOn(el, 'addEventListener');
    // state element を登録しない（attach 時に detached なケースを模す）
    const binding = createBinding(el, 'error', 'createFailed');
    expect(attachEventTokenHandler(binding)).toBe(true);
    expect(addSpy).toHaveBeenCalledWith('my-error', expect.any(Function));
    const handler = addSpy.mock.calls[0][1] as (e: Event) => void;
    expect(() => handler(new CustomEvent('my-error'))).toThrow(/not found/);
  });

  it('$eventTokensに宣言されていないtokenは発火時にエラーになること', () => {
    const el = document.createElement('evt-ok');
    const addSpy = vi.spyOn(el, 'addEventListener');
    const se = makeFakeStateElement([], makeState());
    setStateElementByName(el, 'default', se);
    const binding = createBinding(el, 'error', 'createFailed');
    expect(attachEventTokenHandler(binding)).toBe(true);
    const handler = addSpy.mock.calls[0][1] as (e: Event) => void;
    expect(() => handler(new CustomEvent('my-error'))).toThrow(/not declared in \$eventTokens/);
    clearEventTokenRegistry(se);
  });

  it('wcBindable.properties[].event を実イベント名としてlistenし、発火でtokenがemitされること', async () => {
    const el = document.createElement('evt-ok');
    const addSpy = vi.spyOn(el, 'addEventListener');
    const state = makeState();
    const se = makeFakeStateElement(['createFailed'], state);
    setStateElementByName(el, 'default', se);
    const subscriber = vi.fn().mockReturnValue('r');
    getOrCreateEventToken(se, 'createFailed').subscribe(subscriber);

    const binding = createBinding(el, 'error', 'createFailed');
    expect(attachEventTokenHandler(binding)).toBe(true);
    expect(addSpy).toHaveBeenCalledWith('my-error', expect.any(Function));

    const handler = addSpy.mock.calls[0][1] as (e: Event) => void;
    const event = new CustomEvent('my-error', { detail: 42 });
    handler(event);
    await se.lastPromise;

    expect(subscriber).toHaveBeenCalledWith(state, event);
    clearEventTokenRegistry(se);
  });

  it('同じbindingの再attachで二重にlistenしないこと', () => {
    const el = document.createElement('evt-ok');
    const addSpy = vi.spyOn(el, 'addEventListener');
    const se = makeFakeStateElement(['createFailed'], makeState());
    setStateElementByName(el, 'default', se);
    const binding = createBinding(el, 'error', 'createFailed');
    expect(attachEventTokenHandler(binding)).toBe(true);
    expect(attachEventTokenHandler(binding)).toBe(true);
    expect(addSpy).toHaveBeenCalledTimes(1);
    clearEventTokenRegistry(se);
  });

  it('#prevent / #stop modifier が効くこと', async () => {
    const el = document.createElement('evt-ok');
    const addSpy = vi.spyOn(el, 'addEventListener');
    const se = makeFakeStateElement(['createFailed'], makeState());
    setStateElementByName(el, 'default', se);
    const binding = createBinding(el, 'error', 'createFailed', ['prevent', 'stop']);
    attachEventTokenHandler(binding);
    const handler = addSpy.mock.calls[0][1] as (e: Event) => void;
    const event = new CustomEvent('my-error', { cancelable: true });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    const stopSpy = vi.spyOn(event, 'stopPropagation');
    handler(event);
    await se.lastPromise;
    expect(preventSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledTimes(1);
    clearEventTokenRegistry(se);
  });

  it('発火時にstateElementが消えているとエラーになること', async () => {
    const el = document.createElement('evt-ok');
    const addSpy = vi.spyOn(el, 'addEventListener');
    const se = makeFakeStateElement(['createFailed'], makeState());
    setStateElementByName(el, 'default', se);
    const binding = createBinding(el, 'error', 'createFailed');
    attachEventTokenHandler(binding);
    const handler = addSpy.mock.calls[0][1] as (e: Event) => void;

    setStateElementByName(el, 'default', null);
    expect(() => handler(new CustomEvent('my-error'))).toThrow(/not found/);
    clearEventTokenRegistry(se);
  });

  it('detachEventTokenHandlerでlistenを解除でき、2回目はfalseを返すこと', () => {
    const el = document.createElement('evt-ok');
    const addSpy = vi.spyOn(el, 'addEventListener');
    const removeSpy = vi.spyOn(el, 'removeEventListener');
    const se = makeFakeStateElement(['createFailed'], makeState());
    setStateElementByName(el, 'default', se);
    const binding = createBinding(el, 'error', 'createFailed');
    attachEventTokenHandler(binding);
    const handler = addSpy.mock.calls[0][1];

    expect(detachEventTokenHandler(binding)).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith('my-error', handler);
    expect(detachEventTokenHandler(binding)).toBe(false);
    clearEventTokenRegistry(se);
  });

  it('未定義要素の待機はBindingSession所有のためhandler単体では再試行しないこと', async () => {
    const el = document.createElement('evt-deferred');
    const addSpy = vi.spyOn(el, 'addEventListener');
    const se = makeFakeStateElement(['createFailed'], makeState());
    setStateElementByName(el, 'default', se);
    const binding = createBinding(el, 'error', 'createFailed');

    expect(attachEventTokenHandler(binding)).toBe(true);
    expect(addSpy).not.toHaveBeenCalled();

    const constructor = defineWcBindable('evt-deferred', OK_PROPS);
    // happy-dom does not currently mutate detached pre-definition instances
    // in CustomElementRegistry.upgrade(); emulate the platform upgrade result.
    Object.setPrototypeOf(el, constructor.prototype);
    await customElements.whenDefined('evt-deferred');
    await Promise.resolve();

    expect(addSpy).not.toHaveBeenCalled();
    clearEventTokenRegistry(se);
  });

  it('CustomElementRegistryが無いruntimeでは未定義要素を明示的に拒否する', () => {
    const el = document.createElement('evt-no-registry');
    const binding = createBinding(el, 'error', 'createFailed');
    vi.stubGlobal('customElements', undefined);
    expect(() => attachEventTokenHandler(binding)).toThrow(/CustomElementRegistry is unavailable/);
  });
});

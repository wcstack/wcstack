import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchBindableEvent } from '../src/dcc/dispatchBindableEvent';
import { getPathInfo } from '../src/address/PathInfo';
import { IStateElement } from '../src/components/types';

function createHostedStateElement(map: Record<string, string>): {
  stateElement: IStateElement;
  host: HTMLElement;
  seen: Array<{ type: string; detail: unknown }>;
} {
  const host = document.createElement('x-dispatch-host');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const seen: Array<{ type: string; detail: unknown }> = [];
  for (const eventName of new Set(Object.values(map))) {
    host.addEventListener(eventName, (e) => {
      seen.push({ type: e.type, detail: (e as CustomEvent).detail });
    });
  }
  return {
    stateElement: { bindableEventMap: map, rootNode: shadow } as unknown as IStateElement,
    host,
    seen,
  };
}

describe('dcc/dispatchBindableEvent', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('完全一致では書き込んだ値をdetailに載せて発火すること', () => {
    const { stateElement, seen } = createHostedStateElement({ count: 'x-el:count-changed' });
    dispatchBindableEvent(stateElement, getPathInfo('count'), { value: 7 });
    expect(seen).toEqual([{ type: 'x-el:count-changed', detail: 7 }]);
  });

  // §2.1: `$bindables: ["user"]` で `user.name` を書いても発火しなかった。
  // wc-bindable の properties[].event は「変更で発火する」契約なので乖離していた。
  it('サブパス書き込みでも先頭セグメントのメンバが発火すること', () => {
    const { stateElement, seen } = createHostedStateElement({ user: 'x-el:user-changed' });
    dispatchBindableEvent(stateElement, getPathInfo('user.name'), { value: 'Alice' });
    // メンバ全体ではない値を載せると誤解を招くので detail は付けない
    expect(seen).toEqual([{ type: 'x-el:user-changed', detail: null }]);
  });

  it('リスト要素の書き込みでもリストメンバが発火すること', () => {
    const { stateElement, seen } = createHostedStateElement({ items: 'x-el:items-changed' });
    dispatchBindableEvent(stateElement, getPathInfo('items.*.done'), { value: true });
    expect(seen.map((e) => e.type)).toEqual(['x-el:items-changed']);
  });

  it('$postUpdate相当（値なし）でも発火すること', () => {
    const { stateElement, seen } = createHostedStateElement({ items: 'x-el:items-changed' });
    dispatchBindableEvent(stateElement, getPathInfo('items'));
    expect(seen).toEqual([{ type: 'x-el:items-changed', detail: null }]);
  });

  it('bindableでないパスでは発火しないこと', () => {
    const { stateElement, seen } = createHostedStateElement({ count: 'x-el:count-changed' });
    dispatchBindableEvent(stateElement, getPathInfo('other'), { value: 1 });
    dispatchBindableEvent(stateElement, getPathInfo('other.deep'), { value: 1 });
    expect(seen).toEqual([]);
  });

  it('マップが空なら何も起きないこと', () => {
    const { stateElement, seen } = createHostedStateElement({});
    dispatchBindableEvent(stateElement, getPathInfo('count.deep'), { value: 1 });
    expect(seen).toEqual([]);
  });

  it('rootNodeがShadowRootでなければ発火しないこと', () => {
    const host = document.createElement('x-plain-host');
    document.body.appendChild(host);
    let fired = 0;
    host.addEventListener('x-el:count-changed', () => { fired += 1; });
    const stateElement = {
      bindableEventMap: { count: 'x-el:count-changed' },
      rootNode: document,
    } as unknown as IStateElement;

    dispatchBindableEvent(stateElement, getPathInfo('count'), { value: 1 });
    expect(fired).toBe(0);
  });
});

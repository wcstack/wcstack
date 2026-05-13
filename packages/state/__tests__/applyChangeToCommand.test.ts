import { describe, it, expect, vi, beforeAll } from 'vitest';
import { applyChangeToCommand, __private__ } from '../src/apply/applyChangeToCommand';
import { CommandToken } from '../src/command/CommandToken';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';
import type { IWcBindable } from '../src/event/types';

const dummyContext: IApplyContext = {
  stateName: 'default',
  stateElement: {} as any,
  state: {} as any,
  appliedBindingSet: new Set(),
} as any;

function defineCustomElement(tagName: string, fetchFn: ((...args: unknown[]) => unknown) | null, bindable: IWcBindable | undefined): void {
  if (customElements.get(tagName)) return;
  class C extends HTMLElement {
    static wcBindable: IWcBindable | undefined = bindable;
    fetch(...args: unknown[]): unknown {
      return fetchFn ? fetchFn(...args) : undefined;
    }
  }
  customElements.define(tagName, C);
}

function createBinding(element: Element, methodName: string): IBindingInfo {
  return {
    propName: `command.${methodName}`,
    propSegments: ['command', methodName],
    propModifiers: [],
    statePathName: 'fetchUsers',
    statePathInfo: getPathInfo('fetchUsers'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'prop',
    uuid: null,
    node: element,
    replaceNode: element,
  } as IBindingInfo;
}

describe('applyChangeToCommand', () => {
  beforeAll(() => {
    defineCustomElement('cmd-fetch-ok', null, {
      protocol: 'wc-bindable',
      version: 1,
      properties: [],
      commands: [{ name: 'fetch' }],
    });
    defineCustomElement('cmd-fetch-no-commands', null, {
      protocol: 'wc-bindable',
      version: 1,
      properties: [],
    });
    defineCustomElement('cmd-fetch-no-bindable', null, undefined);
  });

  it('CommandTokenでない値が渡されるとエラーになること', () => {
    const el = document.createElement('cmd-fetch-ok');
    document.body.appendChild(el);
    const binding = createBinding(el, 'fetch');
    expect(() => applyChangeToCommand(binding, dummyContext, 'not-a-token')).toThrow(/CommandToken/);
    el.remove();
  });

  it('wc-bindableでない要素ではエラーになること', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const binding = createBinding(el, 'fetch');
    const token = new CommandToken('fetchUsers');
    expect(() => applyChangeToCommand(binding, dummyContext, token)).toThrow(/wc-bindable/);
    el.remove();
  });

  it('カスタム要素にwcBindableが無いとエラーになること', () => {
    const el = document.createElement('cmd-fetch-no-bindable');
    document.body.appendChild(el);
    const binding = createBinding(el, 'fetch');
    const token = new CommandToken('fetchUsers');
    expect(() => applyChangeToCommand(binding, dummyContext, token)).toThrow(/wc-bindable/);
    el.remove();
  });

  it('wcBindable.protocolが不正な場合はエラーになること', () => {
    if (!customElements.get('cmd-fetch-bad-protocol')) {
      class C extends HTMLElement {
        static wcBindable = {
          protocol: 'other' as any,
          version: 1,
          properties: [],
          commands: [{ name: 'fetch' }],
        };
        fetch(): void {}
      }
      customElements.define('cmd-fetch-bad-protocol', C);
    }
    const el = document.createElement('cmd-fetch-bad-protocol');
    document.body.appendChild(el);
    const binding = createBinding(el, 'fetch');
    const token = new CommandToken('fetchUsers');
    expect(() => applyChangeToCommand(binding, dummyContext, token)).toThrow(/wc-bindable/);
    el.remove();
  });

  it('wcBindable.commandsが宣言されていない要素ではエラーになること', () => {
    const el = document.createElement('cmd-fetch-no-commands');
    document.body.appendChild(el);
    const binding = createBinding(el, 'fetch');
    const token = new CommandToken('fetchUsers');
    expect(() => applyChangeToCommand(binding, dummyContext, token)).toThrow(/not declared/);
    el.remove();
  });

  it('commandsに含まれないメソッド名はエラーになること', () => {
    const el = document.createElement('cmd-fetch-ok');
    document.body.appendChild(el);
    const binding = createBinding(el, 'unknown');
    const token = new CommandToken('fetchUsers');
    expect(() => applyChangeToCommand(binding, dummyContext, token)).toThrow(/not declared/);
    el.remove();
  });

  it('subscribeしてemit時に要素のメソッドが呼ばれ引数も渡ること', () => {
    const fn = vi.fn().mockReturnValue('ok');
    if (!customElements.get('cmd-fetch-args')) {
      class C extends HTMLElement {
        static wcBindable: IWcBindable = {
          protocol: 'wc-bindable',
          version: 1,
          properties: [],
          commands: [{ name: 'fetch' }],
        };
        fetch(...args: unknown[]): unknown { return fn(...args); }
      }
      customElements.define('cmd-fetch-args', C);
    }
    const el = document.createElement('cmd-fetch-args');
    document.body.appendChild(el);
    const binding = createBinding(el, 'fetch');
    const token = new CommandToken('fetchUsers');
    applyChangeToCommand(binding, dummyContext, token);
    const results = token.emit('url', { force: true });
    expect(fn).toHaveBeenCalledWith('url', { force: true });
    expect(results).toEqual(['ok']);
    el.remove();
  });

  it('同じバインディング・同じトークンの再評価ではsubscribeを増やさないこと', () => {
    const el = document.createElement('cmd-fetch-ok');
    document.body.appendChild(el);
    const binding = createBinding(el, 'fetch');
    const token = new CommandToken('fetchUsers');
    applyChangeToCommand(binding, dummyContext, token);
    applyChangeToCommand(binding, dummyContext, token);
    expect(token.size).toBe(1);
    el.remove();
  });

  it('同じバインディングに別トークンが来たら古い方をunsubscribeして新しい方にsubscribeすること', () => {
    const el = document.createElement('cmd-fetch-ok');
    document.body.appendChild(el);
    const binding = createBinding(el, 'fetch');
    const tokenA = new CommandToken('a');
    const tokenB = new CommandToken('b');
    applyChangeToCommand(binding, dummyContext, tokenA);
    expect(tokenA.size).toBe(1);
    applyChangeToCommand(binding, dummyContext, tokenB);
    expect(tokenA.size).toBe(0);
    expect(tokenB.size).toBe(1);
    el.remove();
  });

  it('再評価でvalidationが失敗しても旧subscriptionは温存されること(fail-fast)', () => {
    const el = document.createElement('cmd-fetch-ok');
    document.body.appendChild(el);
    const binding = createBinding(el, 'fetch');
    const tokenA = new CommandToken('a');
    applyChangeToCommand(binding, dummyContext, tokenA);
    expect(tokenA.size).toBe(1);

    // 不正な新値（CommandTokenではない）を投げて validation を失敗させる
    expect(() => applyChangeToCommand(binding, dummyContext, 'invalid')).toThrow(/CommandToken/);
    // 旧 subscription はそのまま
    expect(tokenA.size).toBe(1);
    el.remove();
  });

  it('要素がdisconnectされたらemit時に自動unsubscribeされること', () => {
    const el = document.createElement('cmd-fetch-ok');
    document.body.appendChild(el);
    const binding = createBinding(el, 'fetch');
    const token = new CommandToken('fetchUsers');
    applyChangeToCommand(binding, dummyContext, token);
    expect(token.size).toBe(1);
    el.remove();
    token.emit();
    expect(token.size).toBe(0);
    expect(__private__.subscribedBindings.has(binding)).toBe(false);
  });

  it('要素のメソッドが関数でなくなった場合はエラーになること', () => {
    if (!customElements.get('cmd-fetch-broken')) {
      class C extends HTMLElement {
        static wcBindable: IWcBindable = {
          protocol: 'wc-bindable',
          version: 1,
          properties: [],
          commands: [{ name: 'fetch' }],
        };
        fetch(): void {}
      }
      customElements.define('cmd-fetch-broken', C);
    }
    const el = document.createElement('cmd-fetch-broken');
    document.body.appendChild(el);
    const binding = createBinding(el, 'fetch');
    const token = new CommandToken('fetchUsers');
    applyChangeToCommand(binding, dummyContext, token);
    (el as any).fetch = 'not-a-function';
    expect(() => token.emit()).toThrow(/not a function/);
    el.remove();
  });

  it('未定義のカスタム要素はエラーになること', () => {
    const el = document.createElement('cmd-fetch-undefined-tag');
    const binding = createBinding(el, 'fetch');
    const token = new CommandToken('fetchUsers');
    expect(() => applyChangeToCommand(binding, dummyContext, token)).toThrow(/not defined/);
  });

  it('メソッド名が空のpropSegmentsだとエラーになること', () => {
    const el = document.createElement('cmd-fetch-ok');
    document.body.appendChild(el);
    const binding: IBindingInfo = {
      ...createBinding(el, 'fetch'),
      propSegments: ['command'],
    } as IBindingInfo;
    const token = new CommandToken('fetchUsers');
    expect(() => applyChangeToCommand(binding, dummyContext, token)).toThrow(/method name/);
    el.remove();
  });
});

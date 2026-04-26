import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineDCC } from '../src/dcc/defineDCC';
import { config } from '../src/config';

// テスト間でタグ名が衝突しないようにカウンター
let tagCounter = 0;
function uniqueTag() {
  return `dcc-test-${++tagCounter}`;
}

function createHostWithShadowRoot(tagName: string, shadowContent?: string, mode: ShadowRootMode = 'open'): { host: Element, shadow: ShadowRoot } {
  const host = document.createElement(tagName);
  const shadow = host.attachShadow({ mode });
  if (shadowContent) {
    shadow.innerHTML = shadowContent;
  }
  return { host, shadow };
}

describe('dcc/defineDCC', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ハイフンを含まないタグ名はエラーになること', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    expect(() => defineDCC(host, shadow, {})).toThrow('must contain a hyphen');
  });

  it('既に登録済みのタグ名はconsole.warnで通知してスキップされること', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = uniqueTag();
    customElements.define(tag, class extends HTMLElement {});
    const { host, shadow } = createHostWithShadowRoot(tag);
    expect(() => defineDCC(host, shadow, {})).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`DCC: "${tag}" is already registered`)
    );
    warnSpy.mockRestore();
  });

  it('基本的なDCCクラスが登録されること', () => {
    const tag = uniqueTag();
    const { host, shadow } = createHostWithShadowRoot(tag, '<p>hello</p>');
    defineDCC(host, shadow, { count: 0 });

    const DCCClass = customElements.get(tag);
    expect(DCCClass).toBeDefined();
  });

  it('$bindablesがある場合、static wcBindableが設定されること', () => {
    const tag = uniqueTag();
    const { host, shadow } = createHostWithShadowRoot(tag, '<p>test</p>');
    defineDCC(host, shadow, { count: 0, $bindables: ['count'] });

    const DCCClass = customElements.get(tag) as any;
    expect(DCCClass.wcBindable).toEqual({
      protocol: 'wc-bindable',
      version: 1,
      properties: [{ name: 'count', event: `${tag}:count-changed` }],
    });
    expect(DCCClass.bindableEventMap).toEqual({
      count: `${tag}:count-changed`,
    });
  });

  it('$bindablesがない場合、wcBindableはnullになること', () => {
    const tag = uniqueTag();
    const { host, shadow } = createHostWithShadowRoot(tag, '<p>test</p>');
    defineDCC(host, shadow, { count: 0 });

    const DCCClass = customElements.get(tag) as any;
    expect(DCCClass.wcBindable).toBeNull();
    expect(DCCClass.bindableEventMap).toEqual({});
  });

  it('$プレフィックスのプロパティはプロトタイプに定義されないこと', () => {
    const tag = uniqueTag();
    const { host, shadow } = createHostWithShadowRoot(tag, '<p>test</p>');
    defineDCC(host, shadow, { count: 0, $bindables: ['count'], $connectedCallback() {} });

    const DCCClass = customElements.get(tag) as any;
    expect('count' in DCCClass.prototype).toBe(true);
    expect('$bindables' in DCCClass.prototype).toBe(false);
    expect('$connectedCallback' in DCCClass.prototype).toBe(false);
  });

  it('関数プロパティはメソッドとしてプロトタイプに定義されること', () => {
    const tag = uniqueTag();
    const { host, shadow } = createHostWithShadowRoot(tag, '<p>test</p>');
    defineDCC(host, shadow, {
      count: 0,
      inc() { this.count++; },
    });

    const DCCClass = customElements.get(tag) as any;
    const desc = Object.getOwnPropertyDescriptor(DCCClass.prototype, 'inc');
    expect(desc).toBeDefined();
    expect(typeof desc!.value).toBe('function');
  });

  it('非関数プロパティはgetter/setterとしてプロトタイプに定義されること', () => {
    const tag = uniqueTag();
    const { host, shadow } = createHostWithShadowRoot(tag, '<p>test</p>');
    defineDCC(host, shadow, { count: 0 });

    const DCCClass = customElements.get(tag) as any;
    const desc = Object.getOwnPropertyDescriptor(DCCClass.prototype, 'count');
    expect(desc).toBeDefined();
    expect(typeof desc!.get).toBe('function');
    expect(typeof desc!.set).toBe('function');
  });

  it('async関数がAsyncFunctionとして検出されること', () => {
    const tag = uniqueTag();
    const { host, shadow } = createHostWithShadowRoot(tag, '<p>test</p>');
    defineDCC(host, shadow, {
      async fetchData() { return 1; },
    });

    const DCCClass = customElements.get(tag) as any;
    const desc = Object.getOwnPropertyDescriptor(DCCClass.prototype, 'fetchData');
    expect(desc).toBeDefined();
    expect(typeof desc!.value).toBe('function');
  });

  it('closedモードのShadowRootでもDCCクラスが登録されること', () => {
    const tag = uniqueTag();
    const { host, shadow } = createHostWithShadowRoot(tag, '<p>hello</p>', 'closed');
    defineDCC(host, shadow, { count: 0 });

    const DCCClass = customElements.get(tag);
    expect(DCCClass).toBeDefined();
    expect((DCCClass as any).shadowRootMode).toBe('closed');
  });

  describe('DCCElement connectedCallback', () => {
    it('data-wc-definitionがある場合はshadowRootを作成しないこと', () => {
      const tag = uniqueTag();
      const { host, shadow } = createHostWithShadowRoot(tag, '<p>hello</p>');
      defineDCC(host, shadow, { count: 0 });

      const instance = document.createElement(tag);
      instance.setAttribute('data-wc-definition', '');
      document.body.appendChild(instance);
      expect(instance.shadowRoot).toBeNull();
      document.body.removeChild(instance);
    });

    it('通常のインスタンスはshadowRootが作成されること', () => {
      const tag = uniqueTag();
      const { host, shadow } = createHostWithShadowRoot(tag, '<p>hello</p>');
      defineDCC(host, shadow, { count: 0 });

      const instance = document.createElement(tag);
      document.body.appendChild(instance);
      expect(instance.shadowRoot).not.toBeNull();
      document.body.removeChild(instance);
    });

    it('stateElementゲッターがwcs-stateを返すこと', () => {
      const tag = uniqueTag();
      const { host, shadow } = createHostWithShadowRoot(tag, '<p>hello</p><wcs-state></wcs-state>');
      defineDCC(host, shadow, { count: 0 });

      const instance = document.createElement(tag) as any;
      document.body.appendChild(instance);
      const stateEl = instance.stateElement;
      expect(stateEl).not.toBeNull();
      document.body.removeChild(instance);
    });

    it('shadowRootが無い場合のstateElementゲッターはnullishを返すこと', () => {
      const tag = uniqueTag();
      const { host, shadow } = createHostWithShadowRoot(tag, '<p>hello</p>');
      defineDCC(host, shadow, { count: 0 });

      const instance = document.createElement(tag) as any;
      // connectedCallback前は_shadowがない
      expect(instance.stateElement).toBeFalsy();
    });

    it('$bindablesがある場合にbindableEventMapが設定されること', async () => {
      const tag = uniqueTag();
      const { host, shadow } = createHostWithShadowRoot(tag, `<p>hello</p>`);
      defineDCC(host, shadow, { count: 0, $bindables: ['count'] });
      const Cls = customElements.get(tag) as any;
      expect(Cls.bindableEventMap).toEqual({
        count: `${tag}:count-changed`,
      });
    });

    it('connectedCallbackでbindableEventMapがstateElementに設定されること', async () => {
      const tag = uniqueTag();

      // wcs-stateのモックを登録
      const mockStateTag = `dcc-mock-state-${tag}`;
      let capturedMap: Record<string, string> | null = null;
      const mockInitPromise = Promise.resolve();
      if (!customElements.get(mockStateTag)) {
        customElements.define(mockStateTag, class extends HTMLElement {
          get initializePromise() { return mockInitPromise; }
          setBindableEventMap(map: Record<string, string>) { capturedMap = map; }
        });
      }

      // configのタグ名を一時変更
      const origStateTag = config.tagNames.state;
      (config as any).tagNames = { ...config.tagNames, state: mockStateTag };

      try {
        const { host, shadow } = createHostWithShadowRoot(tag, `<p>hello</p><${mockStateTag}></${mockStateTag}>`);
        defineDCC(host, shadow, { count: 0, $bindables: ['count'] });

        const instance = document.createElement(tag) as any;
        document.body.appendChild(instance);

        await mockInitPromise;
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(capturedMap).toEqual({
          count: `${tag}:count-changed`,
        });

        document.body.removeChild(instance);
      } finally {
        (config as any).tagNames = { ...config.tagNames, state: origStateTag };
      }
    });
  });
});

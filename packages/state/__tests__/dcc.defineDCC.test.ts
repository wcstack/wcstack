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
      inputs: [{ name: 'count' }],
    });
    expect(DCCClass.bindableEventMap).toEqual({
      count: `${tag}:count-changed`,
    });
  });

  // §2.4: State の getterPaths / setterPaths 収集はプロトタイプチェーンを歩くのに、
  // アクセサ生成は own descriptor だけを見ていた。走査範囲を揃える。
  it('プロトタイプチェーン上のgetter/メソッドもプロトタイプに生えること', () => {
    class Base {
      get fromBase() { return 'base'; }
      baseMethod() { return 'bm'; }
    }
    class StateClass extends Base {
      own = 1;
    }
    const tag = uniqueTag();
    const { host, shadow } = createHostWithShadowRoot(tag, '<p>test</p>');
    defineDCC(host, shadow, new StateClass() as any);

    const proto = (customElements.get(tag) as any).prototype;
    expect(Object.getOwnPropertyDescriptor(proto, 'own')?.get).toBeTypeOf('function');
    expect(Object.getOwnPropertyDescriptor(proto, 'fromBase')?.get).toBeTypeOf('function');
    expect(typeof proto.baseMethod).toBe('function');
  });

  it('不正な$bindables宣言はdefineDCCの時点でエラーになること', () => {
    const tag = uniqueTag();
    const { host, shadow } = createHostWithShadowRoot(tag, '<p>test</p>');
    expect(() => defineDCC(host, shadow, { count: 0, $bindables: ['count', 'count'] }))
      .toThrow('is duplicated');
    // 落ちた場合はカスタム要素を登録しない
    expect(customElements.get(tag)).toBeUndefined();
  });

  // §1.6 / gate G2: prototype にメソッドは生えるのに commands を宣言していなかったため、
  // applyChangeToCommand が必ず raiseError していた（event-token は動くので双対性が崩れていた）。
  it('$commandsがある場合、wcBindable.commandsが生成されること', () => {
    const tag = uniqueTag();
    const { host, shadow } = createHostWithShadowRoot(tag, '<p>test</p>');
    defineDCC(host, shadow, { count: 0, inc() { /* noop */ }, $bindables: ['count'], $commands: ['inc'] });

    const DCCClass = customElements.get(tag) as any;
    expect(DCCClass.wcBindable.commands).toEqual([{ name: 'inc', async: true }]);
    expect(typeof DCCClass.prototype.inc).toBe('function');
  });

  it('$commandsだけでもwcBindableが生成されること', () => {
    const tag = uniqueTag();
    const { host, shadow } = createHostWithShadowRoot(tag, '<p>test</p>');
    defineDCC(host, shadow, { inc() { /* noop */ }, $commands: ['inc'] });

    const DCCClass = customElements.get(tag) as any;
    expect(DCCClass.wcBindable.properties).toEqual([]);
    expect(DCCClass.wcBindable.commands).toEqual([{ name: 'inc', async: true }]);
    // $bindables が無いので変更イベントは配線しない
    expect(DCCClass.bindableEventMap).toEqual({});
  });

  it('$streams由来の$bindablesにもアクセサが生えること', () => {
    const tag = uniqueTag();
    const { host, shadow } = createHostWithShadowRoot(tag, '<p>test</p>');
    defineDCC(host, shadow, {
      $streams: { ticks: { source: () => [] } },
      $bindables: ['ticks'],
    });

    const proto = (customElements.get(tag) as any).prototype;
    expect(Object.getOwnPropertyDescriptor(proto, 'ticks')?.get).toBeTypeOf('function');
    expect(Object.getOwnPropertyDescriptor(proto, 'ticks')?.set).toBeTypeOf('function');
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

    // 回帰: shadow tree は host の切断後も保持されるため、再接続で attachShadow を
    // 呼び直すと NotSupportedError になる。`if` の false→true 再マウントと `for` の
    // 行プーリングはどちらも同一ノードを unmount → mount する
    // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.3）。
    it('再接続してもattachShadowが呼び直されず内容も重複しないこと', () => {
      const tag = uniqueTag();
      const { host, shadow } = createHostWithShadowRoot(tag, '<p>hello</p>');
      defineDCC(host, shadow, { count: 0 });

      const instance = document.createElement(tag);
      document.body.appendChild(instance);
      const firstShadow = instance.shadowRoot;
      expect(firstShadow).not.toBeNull();
      expect(firstShadow!.querySelectorAll('p').length).toBe(1);

      instance.remove();
      expect(() => document.body.appendChild(instance)).not.toThrow();

      // 同一 shadow が維持され、テンプレートが二重に流し込まれていない
      expect(instance.shadowRoot).toBe(firstShadow);
      expect(instance.shadowRoot!.querySelectorAll('p').length).toBe(1);
      instance.remove();
    });

    it('closedモードでも再接続でthrowしないこと', () => {
      const tag = uniqueTag();
      const { host, shadow } = createHostWithShadowRoot(tag, '<p>hello</p>', 'closed');
      defineDCC(host, shadow, { count: 0 });

      const instance = document.createElement(tag) as any;
      document.body.appendChild(instance);
      const stateElementBefore = instance.stateElement;
      instance.remove();
      expect(() => document.body.appendChild(instance)).not.toThrow();
      // closed では shadowRoot が露出しないため stateElement ゲッター経由で同一性を見る
      expect(instance.stateElement).toBe(stateElementBefore);
      instance.remove();
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

    it('テンプレートに無名のwcs-stateが無ければstateElementゲッターはnullishを返すこと', () => {
      const tag = uniqueTag();
      const { host, shadow } = createHostWithShadowRoot(tag, '<p>hello</p>');
      defineDCC(host, shadow, { count: 0 });

      const instance = document.createElement(tag) as any;
      expect(instance.stateElement).toBeFalsy();
    });

    it('定義要素ではshadowを張らずstateElementもnullishであること', () => {
      const tag = uniqueTag();
      const { host, shadow } = createHostWithShadowRoot(tag, `<p>hello</p>`);
      defineDCC(host, shadow, { count: 0 });

      // 定義要素自身も upgrade されるが、DSD の shadow を持っているので張り直さない
      expect((host as any).stateElement).toBeFalsy();
      expect(host.shadowRoot).toBe(shadow);
    });

    // §1.4 / gate G4: `for` の全追加パスは行を fragment に組んでからバインドを適用し、
    // fragment を DOM に挿すのは最後。適用時点で行は未接続なので、shadow を
    // connectedCallback まで作らないと stateElement が null になり書き込みが無言で消える。
    it('未接続でもアクセサが解決し、書き込みは接続後に適用されること', async () => {
      const tag = uniqueTag();
      const mockStateTag = `dcc-mock-lazy-${tag}`;
      const writes: Array<[string, unknown]> = [];
      let resolveInit!: () => void;
      const initPromise = new Promise<void>((resolve) => { resolveInit = resolve; });
      customElements.define(mockStateTag, class extends HTMLElement {
        get initializePromise() { return initPromise; }
        setBindableEventMap() { /* noop */ }
        connectedCallback() { resolveInit(); }
        createState(_mutability: string, callback: (state: any) => void) {
          callback(new Proxy({} as any, {
            set(_target, prop, value) { writes.push([String(prop), value]); return true; },
          }));
        }
      });

      const origStateTag = config.tagNames.state;
      (config as any).tagNames = { ...config.tagNames, state: mockStateTag };
      try {
        const { host, shadow } = createHostWithShadowRoot(tag, `<${mockStateTag}></${mockStateTag}>`);
        defineDCC(host, shadow, { count: 0 });

        const instance = document.createElement(tag) as any;
        // 未接続でも shadow が構築され stateElement が解決する
        expect(instance.stateElement).not.toBeNull();

        instance.count = 5;
        await Promise.resolve();
        // まだ接続していないので initializePromise は未解決 = 適用されない（捨てられてもいない）
        expect(writes).toEqual([]);

        document.body.appendChild(instance);
        await initPromise;
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(writes).toEqual([['count', 5]]);
        instance.remove();
      } finally {
        (config as any).tagNames = { ...config.tagNames, state: origStateTag };
      }
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

    // §2.5: stateTagSelector は `:not([name])` なので name 付き <wcs-state> は一致しない。
    // 黙って壊れる代わりに warn を出す。
    it('$bindablesがあるのに無名のwcs-stateが無い場合はconsole.warnで通知されること', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const tag = uniqueTag();
      const { host, shadow } = createHostWithShadowRoot(
        tag,
        `<p>hello</p><${config.tagNames.state} name="scoped"></${config.tagNames.state}>`,
      );
      defineDCC(host, shadow, { count: 0, $bindables: ['count'] });

      const instance = document.createElement(tag);
      document.body.appendChild(instance);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('has no <'),
      );
      instance.remove();
      warnSpy.mockRestore();
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

        // §2.7: initializePromise を待たずに同期で設定される。待っていた頃は
        // state ロード完了までマップが空で、$connectedCallback 内の初期変更が
        // 変更イベントを出さなかった。
        expect(capturedMap).toEqual({
          count: `${tag}:count-changed`,
        });

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

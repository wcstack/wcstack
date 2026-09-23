import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyChangeToProperty } from '../src/apply/applyChangeToProperty';
import { getPathInfo } from '../src/address/PathInfo';
import { config } from '../src/config';
import { getSsrProperties, clearSsrPropertyStore } from '../src/apply/ssrPropertyStore';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

const dummyContext: IApplyContext = {
  stateElement: {} as any,
  state: {} as any,
  appliedBindingSet: new Set(),
};

function createBinding(element: Element, propSegments: string[]): IBindingInfo {
  return {
    propName: propSegments[0],
    propSegments,
    propModifiers: [],
    statePathName: 'value',
    statePathInfo: getPathInfo('value'),
    outFilters: [],
    inFilters: [],
    bindingType: 'prop',
    uuid: null,
    node: element,
    replaceNode: element,
  } as IBindingInfo;
}

describe('applyChangeToProperty', () => {
  it('同じ値の場合は変更しないこと', () => {
    const input = document.createElement('input');
    input.value = 'a';
    const binding = createBinding(input, ['value']);
    applyChangeToProperty(binding, dummyContext, 'a');
    expect(input.value).toBe('a');
  });

  it('値が異なる場合は更新すること', () => {
    const input = document.createElement('input');
    input.value = 'a';
    const binding = createBinding(input, ['value']);
    applyChangeToProperty(binding, dummyContext, 'b');
    expect(input.value).toBe('b');
  });

  it('ネストしたプロパティを更新できること', () => {
    const el = document.createElement('div') as any;
    el.foo = { bar: { baz: 1 } };
    const binding = createBinding(el, ['foo', 'bar', 'baz']);
    applyChangeToProperty(binding, dummyContext, 2);
    expect(el.foo.bar.baz).toBe(2);
  });

  it('ネストプロパティの同じ値の場合は変更しないこと', () => {
    const el = document.createElement('div') as any;
    el.foo = { bar: { baz: 1 } };
    const binding = createBinding(el, ['foo', 'bar', 'baz']);
    applyChangeToProperty(binding, dummyContext, 1);
    expect(el.foo.bar.baz).toBe(1);
  });

  it('途中のオブジェクトがnullの場合は何もしないこと', () => {
    const el = document.createElement('div') as any;
    el.foo = null;
    const binding = createBinding(el, ['foo', 'bar', 'baz']);
    applyChangeToProperty(binding, dummyContext, 2);
    expect(el.foo).toBeNull();
  });

  it('ネストしたプロパティの親オブジェクトがfrozenの場合は変更しないこと', () => {
    const el = document.createElement('div') as any;
    el.foo = { bar: Object.freeze({ baz: 1 }) };
    const binding = createBinding(el, ['foo', 'bar', 'baz']);
    applyChangeToProperty(binding, dummyContext, 2);
    expect(el.foo.bar.baz).toBe(1);
  });

  it('frozenオブジェクトでconfig.debug=trueの場合はconsole.warnが呼ばれること', () => {
    config.debug = true;
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div') as any;
    el.foo = { bar: Object.freeze({ baz: 1 }) };
    const binding = createBinding(el, ['foo', 'bar', 'baz']);
    applyChangeToProperty(binding, dummyContext, 2);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    config.debug = false;
  });

  it('単一プロパティ設定でエラーが発生した場合、debug=trueならconsole.warnが呼ばれること', () => {
    config.debug = true;
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div') as any;
    Object.defineProperty(el, 'readOnly', {
      get() { return 'fixed'; },
      set() { throw new Error('cannot set'); },
    });
    const binding = createBinding(el, ['readOnly']);
    applyChangeToProperty(binding, dummyContext, 'new');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to set property 'readOnly' on element."),
      expect.objectContaining({ newValue: 'new' })
    );
    spy.mockRestore();
    config.debug = false;
  });

  it('単一プロパティ設定でエラーが発生した場合、debug=falseなら何もしないこと', () => {
    config.debug = false;
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div') as any;
    Object.defineProperty(el, 'readOnly', {
      get() { return 'fixed'; },
      set() { throw new Error('cannot set'); },
    });
    const binding = createBinding(el, ['readOnly']);
    applyChangeToProperty(binding, dummyContext, 'new');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('ネストプロパティ設定でエラーが発生した場合、debug=trueならconsole.warnが呼ばれること', () => {
    config.debug = true;
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div') as any;
    const inner = {};
    Object.defineProperty(inner, 'val', {
      get() { return 'fixed'; },
      set() { throw new Error('cannot set'); },
    });
    el.foo = { bar: inner };
    const binding = createBinding(el, ['foo', 'bar', 'val']);
    applyChangeToProperty(binding, dummyContext, 'new');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to set property on sub-object."),
      expect.objectContaining({ newValue: 'new' })
    );
    spy.mockRestore();
    config.debug = false;
  });

  it('ネストプロパティ設定でエラーが発生した場合、debug=falseなら何もしないこと', () => {
    config.debug = false;
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div') as any;
    const inner = {};
    Object.defineProperty(inner, 'val', {
      get() { return 'fixed'; },
      set() { throw new Error('cannot set'); },
    });
    el.foo = { bar: inner };
    const binding = createBinding(el, ['foo', 'bar', 'val']);
    applyChangeToProperty(binding, dummyContext, 'new');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  describe('undefined はプロパティ書き込みをスキップ (state 未初期化 = 無意見)', () => {
    it('undefined の場合はプロパティを書き込まず要素側の値を維持すること', () => {
      const el = document.createElement('div') as any;
      el.foo = 'element-default';
      const binding = createBinding(el, ['foo']);
      applyChangeToProperty(binding, dummyContext, undefined);
      expect(el.foo).toBe('element-default');
    });

    it('null は明示クリアとして従来どおり書き込まれること', () => {
      const el = document.createElement('div') as any;
      el.foo = 'element-default';
      const binding = createBinding(el, ['foo']);
      applyChangeToProperty(binding, dummyContext, null);
      expect(el.foo).toBeNull();
    });

    it('ネストプロパティでも undefined はスキップされること', () => {
      const el = document.createElement('div') as any;
      el.foo = { bar: { baz: 1 } };
      const binding = createBinding(el, ['foo', 'bar', 'baz']);
      applyChangeToProperty(binding, dummyContext, undefined);
      expect(el.foo.bar.baz).toBe(1);
    });

    it('undefined の場合 debug=true なら console.debug が呼ばれること', () => {
      config.debug = true;
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const el = document.createElement('div');
      const binding = createBinding(el, ['foo']);
      applyChangeToProperty(binding, dummyContext, undefined);
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('Skipped property write'),
        expect.objectContaining({ statePathName: 'value' })
      );
      spy.mockRestore();
      config.debug = false;
    });

    it('undefined の場合 debug=false なら console.debug は呼ばれないこと', () => {
      config.debug = false;
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const el = document.createElement('div');
      const binding = createBinding(el, ['foo']);
      applyChangeToProperty(binding, dummyContext, undefined);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('SSR モードでも undefined はスキップされ属性・ストアに積まれないこと', () => {
      document.documentElement.setAttribute('data-wcs-server', '');
      try {
        const input = document.createElement('input');
        applyChangeToProperty(createBinding(input, ['value']), dummyContext, undefined);
        expect(input.hasAttribute('value')).toBe(false);

        const el = document.createElement('div');
        applyChangeToProperty(createBinding(el, ['custom']), dummyContext, undefined);
        expect(getSsrProperties(el)).toEqual([]);
      } finally {
        document.documentElement.removeAttribute('data-wcs-server');
        clearSsrPropertyStore();
      }
    });
  });

  /**
   * 表示のテキストプロパティ（textContent / innerText）は IDL 側で文字列化される
   * （textContent は nullable DOMString、innerText は [LegacyNullToEmptyString]）。
   * 生値のまま代入して IDL に任せていたため、happy-dom の setter が**非文字列の falsy を
   * 落とす**SSR 出力でだけ `textContent: zero` が空になっていた（ハイドレーション用 props には
   * 正しい値が載るのでクライアントでは戻る＝ no-JS / SEO / 初回描画だけが壊れる）。
   */
  describe('表示のテキストプロパティを IDL と同じ規則で文字列化する', () => {
    it.each(['textContent', 'innerText'])('%s: falsy な非文字列が消えないこと', (prop) => {
      const el = document.createElement('span');
      applyChangeToProperty(createBinding(el, [prop]), dummyContext, 0);
      expect((el as any)[prop]).toBe('0');
      applyChangeToProperty(createBinding(el, [prop]), dummyContext, false);
      expect((el as any)[prop]).toBe('false');
      applyChangeToProperty(createBinding(el, [prop]), dummyContext, 5);
      expect((el as any)[prop]).toBe('5');
    });

    it('null / undefined は空文字になること', () => {
      const el = document.createElement('span');
      for (const empty of [null, undefined]) {
        el.textContent = 'seed';
        applyChangeToProperty(createBinding(el, ['textContent']), dummyContext, empty);
        expect(el.textContent, String(empty)).toBe('');
      }
    });

    it('SSR のハイドレーション用ストアにも文字列化した値が載ること', () => {
      document.documentElement.setAttribute('data-wcs-server', '');
      try {
        const el = document.createElement('span');
        applyChangeToProperty(createBinding(el, ['textContent']), dummyContext, 0);
        expect(el.textContent).toBe('0');
        expect(getSsrProperties(el)).toEqual([{ propName: 'textContent', value: '0' }]);
      } finally {
        document.documentElement.removeAttribute('data-wcs-server');
        clearSsrPropertyStore();
      }
    });

    it('innerHTML は文字列化しないこと（TrustedHTML を String() で潰すと TT 強制下で書き込みが拒否される）', () => {
      const el = document.createElement('div');
      let assigned: unknown = 'seed';
      Object.defineProperty(el, 'innerHTML', {
        configurable: true,
        get: () => assigned,
        set: (v: unknown) => { assigned = v; },
      });
      const trustedLike = { toString: () => '<i>x</i>' };
      applyChangeToProperty(createBinding(el, ['innerHTML']), dummyContext, trustedLike);
      expect(assigned).toBe(trustedLike);
      // undefined を空にする従来の規則は innerHTML にも残る
      applyChangeToProperty(createBinding(el, ['innerHTML']), dummyContext, undefined);
      expect(assigned).toBe('');
    });
  });

  describe('wc-bindable inputs attribute mirror', () => {
    const tagName = 'mirror-host';
    beforeEach(() => {
      if (!customElements.get(tagName)) {
        class C extends HTMLElement {
          static wcBindable = {
            protocol: 'wc-bindable' as const,
            version: 1 as const,
            properties: [],
            inputs: [
              { name: 'data', attribute: 'data' },
              { name: 'label', attribute: 'label-text' },
              { name: 'noMirror' },
            ],
          };
        }
        customElements.define(tagName, C);
      }
    });

    it('inputs[].attribute 宣言があるプロパティはミラー属性も書かれること', () => {
      const el = document.createElement(tagName);
      const binding = createBinding(el, ['data']);
      applyChangeToProperty(binding, dummyContext, 'hello');
      expect((el as any).data).toBe('hello');
      expect(el.getAttribute('data')).toBe('hello');
    });

    it('属性名がプロパティ名と異なる場合 (kebab-case 等) も正しくミラーされること', () => {
      const el = document.createElement(tagName);
      const binding = createBinding(el, ['label']);
      applyChangeToProperty(binding, dummyContext, 'タイトル');
      expect(el.getAttribute('label-text')).toBe('タイトル');
      expect(el.hasAttribute('label')).toBe(false);
    });

    it('inputs に attribute 宣言が無いプロパティはミラーされないこと', () => {
      const el = document.createElement(tagName);
      const binding = createBinding(el, ['noMirror']);
      applyChangeToProperty(binding, dummyContext, 'x');
      expect((el as any).noMirror).toBe('x');
      expect(el.hasAttribute('noMirror')).toBe(false);
    });

    it('ネイティブ要素はミラー対象外 (副作用が出ないこと)', () => {
      const el = document.createElement('div') as any;
      const binding = createBinding(el, ['data']);
      applyChangeToProperty(binding, dummyContext, 'x');
      expect(el.data).toBe('x');
      expect(el.hasAttribute('data')).toBe(false);
    });

    it('undefined ではプロパティもミラー属性も触らないこと', () => {
      const el = document.createElement(tagName);
      (el as any).data = 'kept';
      el.setAttribute('data', 'kept');
      const binding = createBinding(el, ['data']);
      applyChangeToProperty(binding, dummyContext, undefined);
      expect((el as any).data).toBe('kept');
      expect(el.getAttribute('data')).toBe('kept');
    });

    it('null 値ではミラー属性が削除されること', () => {
      const el = document.createElement(tagName);
      el.setAttribute('data', 'old');
      const binding = createBinding(el, ['data']);
      applyChangeToProperty(binding, dummyContext, null);
      expect(el.hasAttribute('data')).toBe(false);
    });

    it('同値だとプロパティ書き込みもミラーも走らないこと', () => {
      const el = document.createElement(tagName);
      (el as any).data = 'x';
      // 既に属性を変な値にしておき、no-op で書き換わらないことを確認
      el.setAttribute('data', 'tampered');
      const binding = createBinding(el, ['data']);
      applyChangeToProperty(binding, dummyContext, 'x');
      expect(el.getAttribute('data')).toBe('tampered');
    });

    it('object 値は JSON.stringify されてミラーされること', () => {
      const el = document.createElement(tagName);
      const binding = createBinding(el, ['data']);
      applyChangeToProperty(binding, dummyContext, { x: 1 });
      expect((el as any).data).toEqual({ x: 1 });
      expect(el.getAttribute('data')).toBe('{"x":1}');
    });

    it('ミラー側で例外が出ても debug=false なら吞み込むこと', () => {
      config.debug = false;
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const el = document.createElement(tagName);
      // setAttribute を投げるようにしてミラーパスを失敗させる
      const orig = el.setAttribute.bind(el);
      el.setAttribute = ((name: string, value: string) => {
        if (name === 'data') throw new Error('mirror failed');
        return orig(name, value);
      }) as any;
      const binding = createBinding(el, ['data']);
      expect(() => applyChangeToProperty(binding, dummyContext, 'v')).not.toThrow();
      expect((el as any).data).toBe('v');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('ミラー側で例外が出たとき debug=true なら warn されること', () => {
      config.debug = true;
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const el = document.createElement(tagName);
      const orig = el.setAttribute.bind(el);
      el.setAttribute = ((name: string, value: string) => {
        if (name === 'data') throw new Error('mirror failed');
        return orig(name, value);
      }) as any;
      const binding = createBinding(el, ['data']);
      applyChangeToProperty(binding, dummyContext, 'v');
      expect(spy).toHaveBeenCalled();
      const [msg] = spy.mock.calls[0];
      expect(msg).toMatch(/mirror attribute 'data'/);
      spy.mockRestore();
      config.debug = false;
    });

    it('プロパティ setter が値を拒否したときはミラー属性を更新しないこと', () => {
      const rejectTag = 'mirror-host-rejecting';
      if (!customElements.get(rejectTag)) {
        class C extends HTMLElement {
          static wcBindable = {
            protocol: 'wc-bindable' as const,
            version: 1 as const,
            properties: [],
            inputs: [{ name: 'data', attribute: 'data' }],
          };
          // setter が常に throw する
          set data(_v: unknown) { throw new Error('rejected by element'); }
          get data(): unknown { return undefined; }
        }
        customElements.define(rejectTag, C);
      }
      const el = document.createElement(rejectTag);
      el.setAttribute('data', 'old');
      const binding = createBinding(el, ['data']);
      // throw は内部で吞み込まれるので例外は出ない
      expect(() => applyChangeToProperty(binding, dummyContext, 'new')).not.toThrow();
      // setter が拒否したので属性は old のまま (property と attribute の乖離を防ぐ)
      expect(el.getAttribute('data')).toBe('old');
    });
  });
});

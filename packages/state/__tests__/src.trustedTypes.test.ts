import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TRUSTED_TYPES_POLICY_SLOT,
  _resetTrustedTypesDiagnostics,
  getTrustedTypesPolicy,
  isHtmlSinkProp,
  isTrustedTypesEnforced,
  reportTrustedTypesBlock,
  setTrustedTypesPolicy,
  trustHtmlValue,
} from '../src/trustedTypes';
import { applyChangeToProperty } from '../src/apply/applyChangeToProperty';
import { defineDCC } from '../src/dcc/defineDCC';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

const dummyContext: IApplyContext = {
  stateName: 'default',
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
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'prop',
    uuid: null,
    node: element,
    replaceNode: element,
  } as IBindingInfo;
}

/**
 * innerHTML を own descriptor として持つプロトタイプを **すべて** 集める。
 *
 * happy-dom の `HTMLTemplateElement` は innerHTML を自前で上書きしている（content
 * 側に書くため）。`Element.prototype` だけ差し替えると `template.innerHTML = ...` が
 * スタブをすり抜け、「sink を使っていない」ことを検証したいテストが常に緑になる。
 */
function findInnerHTMLOwners(): Array<{ proto: any, desc: PropertyDescriptor }> {
  const owners: Array<{ proto: any, desc: PropertyDescriptor }> = [];
  const seen = new Set<any>();
  for (const tag of ['div', 'template']) {
    let proto: any = Object.getPrototypeOf(document.createElement(tag));
    while (proto) {
      if (!seen.has(proto)) {
        seen.add(proto);
        const desc = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
        if (desc) owners.push({ proto, desc });
      }
      proto = Object.getPrototypeOf(proto);
    }
  }
  if (owners.length === 0) throw new Error('innerHTML descriptor not found');
  return owners;
}

/**
 * `require-trusted-types-for 'script'` 下のブラウザを模す。happy-dom には
 * Trusted Types の実装が無いので、sink が投げる状態と `trustedTypes` グローバルの
 * 存在をスタブする。
 */
function withTrustedTypesEnforced<T>(fn: () => T): T {
  const owners = findInnerHTMLOwners();
  for (const { proto, desc } of owners) {
    Object.defineProperty(proto, 'innerHTML', {
      ...desc,
      set(_value: string) {
        throw new TypeError("Failed to set the 'innerHTML' property on 'Element': This document requires 'TrustedHTML' assignment.");
      },
    });
  }
  (globalThis as any).trustedTypes = { createPolicy: () => ({}) };
  try {
    return fn();
  } finally {
    for (const { proto, desc } of owners) {
      Object.defineProperty(proto, 'innerHTML', desc);
    }
    delete (globalThis as any).trustedTypes;
  }
}

describe('trustedTypes', () => {
  beforeEach(() => {
    setTrustedTypesPolicy(null);
    _resetTrustedTypesDiagnostics();
  });

  afterEach(() => {
    setTrustedTypesPolicy(null);
    _resetTrustedTypesDiagnostics();
    vi.restoreAllMocks();
  });

  describe('policy スロット', () => {
    it('未設定なら null を返すこと', () => {
      expect(getTrustedTypesPolicy()).toBeNull();
    });

    it('setTrustedTypesPolicy で設定した policy を返すこと', () => {
      const policy = { createHTML: (s: string) => s };
      setTrustedTypesPolicy(policy);
      expect(getTrustedTypesPolicy()).toBe(policy);
    });

    it('グローバルスロットに直接入れた policy も読めること（buildless 経路）', () => {
      const policy = { createHTML: (s: string) => s };
      (globalThis as any)[TRUSTED_TYPES_POLICY_SLOT] = policy;
      expect(getTrustedTypesPolicy()).toBe(policy);
    });

    it('オブジェクト以外がスロットに入っていたら null を返すこと', () => {
      (globalThis as any)[TRUSTED_TYPES_POLICY_SLOT] = 'not-a-policy';
      expect(getTrustedTypesPolicy()).toBeNull();
    });
  });

  describe('isHtmlSinkProp', () => {
    it('TrustedHTML が要求されるプロパティだけ true になること', () => {
      expect(isHtmlSinkProp('innerHTML')).toBe(true);
      expect(isHtmlSinkProp('outerHTML')).toBe(true);
      expect(isHtmlSinkProp('srcdoc')).toBe(true);
      expect(isHtmlSinkProp('textContent')).toBe(false);
      expect(isHtmlSinkProp('value')).toBe(false);
    });
  });

  describe('trustHtmlValue', () => {
    it('文字列以外はそのまま返すこと', () => {
      const value = { toString: () => 'x' };
      expect(trustHtmlValue(value)).toBe(value);
    });

    it('policy が無ければ素通しすること（TT 下ではブラウザが弾く＝意図どおり）', () => {
      expect(trustHtmlValue('<b>x</b>')).toBe('<b>x</b>');
    });

    it('createHTML を持たない policy なら素通しすること', () => {
      setTrustedTypesPolicy({ createScriptURL: (s: string) => s });
      expect(trustHtmlValue('<b>x</b>')).toBe('<b>x</b>');
    });

    it('policy があれば createHTML を通すこと（policy を this にして呼ぶ）', () => {
      const policy = {
        prefix: '[s]',
        createHTML(this: any, s: string) { return `${this.prefix}${s}`; },
      };
      setTrustedTypesPolicy(policy);
      expect(trustHtmlValue('<b>x</b>')).toBe('[s]<b>x</b>');
    });
  });

  describe('isTrustedTypesEnforced', () => {
    it('trustedTypes グローバルが無ければ false を返すこと', () => {
      expect(isTrustedTypesEnforced()).toBe(false);
    });

    it('trustedTypes があっても書き込みが通るなら false を返すこと（default policy 相当）', () => {
      (globalThis as any).trustedTypes = { createPolicy: () => ({}) };
      try {
        expect(isTrustedTypesEnforced()).toBe(false);
      } finally {
        delete (globalThis as any).trustedTypes;
      }
    });

    it('sink が投げるなら true を返し、結果をキャッシュすること', () => {
      withTrustedTypesEnforced(() => {
        expect(isTrustedTypesEnforced()).toBe(true);
      });
      // スタブを外した後もキャッシュ済みの結果を返す（cold path で 1 度だけ実測する）
      expect(isTrustedTypesEnforced()).toBe(true);
    });
  });

  describe('reportTrustedTypesBlock', () => {
    it('TT が強制されていなければ何も出さないこと', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      reportTrustedTypesBlock(document.createElement('div'), 'innerHTML');
      expect(spy).not.toHaveBeenCalled();
    });

    it('policy 未設定なら「identity policy は通さない」旨を 1 度だけ報告すること', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      withTrustedTypesEnforced(() => {
        reportTrustedTypesBlock(document.createElement('div'), 'innerHTML');
        reportTrustedTypesBlock(document.createElement('div'), 'innerHTML');
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain('blocked by Trusted Types');
      expect(spy.mock.calls[0][0]).toContain('does not pass state values through an identity policy');
    });

    it('policy 設定済みなら policy 側の戻り値を疑うメッセージにすること', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      setTrustedTypesPolicy({ createHTML: (s: string) => s });
      withTrustedTypesEnforced(() => {
        reportTrustedTypesBlock(document.createElement('div'), 'innerHTML');
      });
      expect(spy.mock.calls[0][0]).toContain("did not return a TrustedHTML");
    });
  });

  // 本対応の中心的な主張: DCC 定義は innerHTML sink を使わなくなったので、
  // `@wcstack/state` は CSP の `trusted-types` allowlist 無しで TT 下を通る。
  // 機能テスト（dcc.defineDCC.test.ts）はこの性質を守らないため、ここで固定する。
  describe('defineDCC の sink 除去', () => {
    let tagCounter = 0;

    it('innerHTML sink が弾かれる環境でも DCC を定義でき、テンプレートが複製されること', () => {
      const tag = `dcc-tt-${++tagCounter}`;
      const host = document.createElement(tag);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<p class="greet">hello</p>';

      withTrustedTypesEnforced(() => {
        expect(() => defineDCC(host, shadow, { count: 0 })).not.toThrow();
      });

      const DCCClass = customElements.get(tag) as any;
      expect(DCCClass).toBeDefined();
      // innerHTML を読まずに、複製されたノードの側から中身を確かめる
      const cloned = DCCClass.template.content.firstElementChild as HTMLElement;
      expect(cloned.tagName).toBe('P');
      expect(cloned.getAttribute('class')).toBe('greet');
      expect(cloned.textContent).toBe('hello');
    });

    it('policy を一切用意しなくても定義できること（allowlist 不要の担保）', () => {
      const tag = `dcc-tt-${++tagCounter}`;
      const host = document.createElement(tag);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<span>x</span>';
      const createHTML = vi.fn((s: string) => s);
      setTrustedTypesPolicy({ createHTML });

      withTrustedTypesEnforced(() => {
        defineDCC(host, shadow, {});
      });

      expect(createHTML).not.toHaveBeenCalled();
      expect(customElements.get(tag)).toBeDefined();
    });
  });

  describe('applyChangeToProperty との結線', () => {
    it('HTML sink への書き込みが policy を通ること', () => {
      setTrustedTypesPolicy({ createHTML: (_s: string) => '<i>sanitized</i>' });
      const el = document.createElement('div');
      applyChangeToProperty(createBinding(el, ['innerHTML']), dummyContext, '<img onerror="x">');
      expect(el.innerHTML).toBe('<i>sanitized</i>');
    });

    it('HTML sink 以外は policy を通さないこと', () => {
      const createHTML = vi.fn((s: string) => s);
      setTrustedTypesPolicy({ createHTML });
      const el = document.createElement('div');
      applyChangeToProperty(createBinding(el, ['textContent']), dummyContext, '<b>x</b>');
      expect(createHTML).not.toHaveBeenCalled();
      expect(el.textContent).toBe('<b>x</b>');
    });

    it('TT に弾かれたら config.debug に関係なく報告すること', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      withTrustedTypesEnforced(() => {
        const el = document.createElement('div');
        applyChangeToProperty(createBinding(el, ['innerHTML']), dummyContext, '<b>x</b>');
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain('blocked by Trusted Types');
    });

    it('HTML sink 以外の書き込み失敗は TT 診断を出さないこと', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const el = document.createElement('div');
      Object.defineProperty(el, 'foo', {
        get() { return undefined; },
        set() { throw new TypeError('nope'); },
      });
      applyChangeToProperty(createBinding(el, ['foo']), dummyContext, 'x');
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

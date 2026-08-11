import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TRUSTED_TYPES_POLICY_SLOT,
  _resetInternalTrustedTypesPolicy,
  getTrustedTypesPolicy,
  setTrustedTypesPolicy,
  trustAuthoredHTML,
} from '../src/trustedTypes';
import { Layout } from '../src/components/Layout';

/** Trusted Types のポリシーファクトリをスタブする（happy-dom には実装が無い）。 */
function stubTrustedTypes(createPolicy: (name: string, rules: any) => any): void {
  (globalThis as any).trustedTypes = { createPolicy };
}

describe('trustedTypes', () => {
  beforeEach(() => {
    setTrustedTypesPolicy(null);
    _resetInternalTrustedTypesPolicy();
  });

  afterEach(() => {
    setTrustedTypesPolicy(null);
    _resetInternalTrustedTypesPolicy();
    delete (globalThis as any).trustedTypes;
    vi.restoreAllMocks();
  });

  describe('policy スロット', () => {
    it('未設定なら null を返すこと', () => {
      expect(getTrustedTypesPolicy()).toBeNull();
    });

    it('グローバルスロットに直接入れた policy も読めること（buildless 経路）', () => {
      const policy = { createHTML: (s: string) => s };
      (globalThis as any)[TRUSTED_TYPES_POLICY_SLOT] = policy;
      expect(getTrustedTypesPolicy()).toBe(policy);
    });

    it('オブジェクト以外がスロットに入っていたら null を返すこと', () => {
      (globalThis as any)[TRUSTED_TYPES_POLICY_SLOT] = 42;
      expect(getTrustedTypesPolicy()).toBeNull();
    });
  });

  describe('trustAuthoredHTML', () => {
    it('Trusted Types 非対応ブラウザでは生文字列のまま返すこと', () => {
      expect(trustAuthoredHTML('<p>x</p>')).toBe('<p>x</p>');
    });

    it('利用側 policy があれば identity policy より優先すること', () => {
      const createPolicy = vi.fn();
      stubTrustedTypes(createPolicy);
      setTrustedTypesPolicy({ createHTML: (s: string) => `[adopted]${s}` });
      expect(trustAuthoredHTML('<p>x</p>')).toBe('[adopted]<p>x</p>');
      expect(createPolicy).not.toHaveBeenCalled();
    });

    it('createHTML を持たない利用側 policy なら identity policy に落ちること', () => {
      stubTrustedTypes((_name, rules) => ({ createHTML: (s: string) => `[internal]${rules.createHTML(s)}` }));
      setTrustedTypesPolicy({ createScriptURL: (s: string) => s });
      expect(trustAuthoredHTML('<p>x</p>')).toBe('[internal]<p>x</p>');
    });

    it('policy 名 "wcstack" で 1 度だけ createPolicy すること（重複生成は例外になるため）', () => {
      const createPolicy = vi.fn((_name: string, rules: any) => ({ createHTML: rules.createHTML }));
      stubTrustedTypes(createPolicy);
      trustAuthoredHTML('<p>1</p>');
      trustAuthoredHTML('<p>2</p>');
      expect(createPolicy).toHaveBeenCalledTimes(1);
      expect(createPolicy.mock.calls[0][0]).toBe('wcstack');
      // identity: 作者が書いたマークアップをそのまま通す
      expect(createPolicy.mock.calls[0][1].createHTML('<p>x</p>')).toBe('<p>x</p>');
      expect(createPolicy.mock.calls[0][1].createScriptURL('./w.js')).toBe('./w.js');
    });

    it('createPolicy が弾かれたら直し方を 1 度だけ報告し、生文字列で進むこと', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      stubTrustedTypes(() => { throw new TypeError('Policy "wcstack" disallowed.'); });
      expect(trustAuthoredHTML('<p>x</p>')).toBe('<p>x</p>');
      expect(trustAuthoredHTML('<p>y</p>')).toBe('<p>y</p>');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain('trusted-types wcstack;');
    });
  });

  describe('<wcs-layout> との結線', () => {
    it('文書内テンプレートの展開が policy を通ること', async () => {
      stubTrustedTypes((_name, rules) => ({ createHTML: rules.createHTML }));
      const createHTML = vi.fn((s: string) => s);
      setTrustedTypesPolicy({ createHTML });

      const source = document.createElement('template');
      source.id = 'tt-layout';
      source.innerHTML = '<header>hi</header>';
      document.body.appendChild(source);

      const layout = new Layout();
      layout.setAttribute('layout', 'tt-layout');
      const template = await layout.loadTemplate();

      expect(createHTML).toHaveBeenCalledWith('<header>hi</header>');
      expect(template.innerHTML).toBe('<header>hi</header>');
      source.remove();
    });

    it('src 由来のテンプレートも policy を通ること', async () => {
      const createHTML = vi.fn((s: string) => s);
      setTrustedTypesPolicy({ createHTML });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => '<main>from src</main>',
      } as unknown as Response);

      const layout = new Layout();
      layout.setAttribute('src', '/layouts/tt.html');
      const template = await layout.loadTemplate();

      expect(fetchSpy).toHaveBeenCalledWith('/layouts/tt.html');
      expect(createHTML).toHaveBeenCalledWith('<main>from src</main>');
      expect(template.innerHTML).toBe('<main>from src</main>');

      // 2 回目はキャッシュから読むが、こちらも policy を通ること
      createHTML.mockClear();
      const cached = new Layout();
      cached.setAttribute('src', '/layouts/tt.html');
      await cached.loadTemplate();
      expect(createHTML).toHaveBeenCalledWith('<main>from src</main>');
    });
  });
});

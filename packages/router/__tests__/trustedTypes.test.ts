import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TRUSTED_TYPES_POLICY_SLOT,
  _resetAuthoredFallbackWarning,
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
    _resetAuthoredFallbackWarning();
  });

  afterEach(() => {
    setTrustedTypesPolicy(null);
    _resetInternalTrustedTypesPolicy();
    _resetAuthoredFallbackWarning();
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

    // 利用側 policy は「信頼できない値の sanitizer」として設定される（案内している例も
    // DOMPurify）。作者が書いたレイアウトをそこに通すと、既定でカスタム要素が除去されて
    // <wcs-link> などが無言で消える。identity policy を優先すること。
    it('利用側 policy が入っていても作者マークアップは identity policy を通ること', () => {
      const createHTML = vi.fn((s: string) => s);
      stubTrustedTypes((_name, rules) => ({ createHTML: (s: string) => `[internal]${rules.createHTML(s)}` }));
      setTrustedTypesPolicy({ createHTML });
      expect(trustAuthoredHTML('<wcs-link to="/a">a</wcs-link>')).toBe('[internal]<wcs-link to="/a">a</wcs-link>');
      expect(createHTML).not.toHaveBeenCalled();
    });

    it('Trusted Types 非対応ブラウザなら、利用側 policy があっても素通しすること', () => {
      const createHTML = vi.fn((s: string) => s);
      setTrustedTypesPolicy({ createHTML });
      expect(trustAuthoredHTML('<wcs-link to="/a">a</wcs-link>')).toBe('<wcs-link to="/a">a</wcs-link>');
      expect(createHTML).not.toHaveBeenCalled();
    });

    it('identity policy を作れなかった場合だけ利用側 policy に落ち、1 度だけ警告すること', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      stubTrustedTypes(() => { throw new TypeError('Policy "wcstack" disallowed.'); });
      setTrustedTypesPolicy({ createHTML: (s: string) => `[adopted]${s}` });

      expect(trustAuthoredHTML('<p>x</p>')).toBe('[adopted]<p>x</p>');
      expect(trustAuthoredHTML('<p>y</p>')).toBe('[adopted]<p>y</p>');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('custom elements in the layout may be stripped');
      expect(errorSpy).toHaveBeenCalledTimes(1);
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
    it('文書内テンプレートの展開が identity policy を通り、利用側 sanitizer には触れないこと', async () => {
      const internalCreateHTML = vi.fn((s: string) => s);
      stubTrustedTypes(() => ({ createHTML: internalCreateHTML }));
      const adoptedCreateHTML = vi.fn((s: string) => s);
      setTrustedTypesPolicy({ createHTML: adoptedCreateHTML });

      const source = document.createElement('template');
      source.id = 'tt-layout';
      source.innerHTML = '<header><wcs-link to="/a">a</wcs-link></header>';
      document.body.appendChild(source);

      const layout = new Layout();
      layout.setAttribute('layout', 'tt-layout');
      const template = await layout.loadTemplate();

      expect(internalCreateHTML).toHaveBeenCalledWith('<header><wcs-link to="/a">a</wcs-link></header>');
      expect(adoptedCreateHTML).not.toHaveBeenCalled();
      expect(template.innerHTML).toBe('<header><wcs-link to="/a">a</wcs-link></header>');
      source.remove();
    });

    it('src 由来のテンプレートも identity policy を通ること（キャッシュ経由も同じ）', async () => {
      const internalCreateHTML = vi.fn((s: string) => s);
      stubTrustedTypes(() => ({ createHTML: internalCreateHTML }));
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => '<main>from src</main>',
      } as unknown as Response);

      const layout = new Layout();
      layout.setAttribute('src', '/layouts/tt.html');
      const template = await layout.loadTemplate();

      expect(fetchSpy).toHaveBeenCalledWith('/layouts/tt.html');
      expect(internalCreateHTML).toHaveBeenCalledWith('<main>from src</main>');
      expect(template.innerHTML).toBe('<main>from src</main>');

      // 2 回目はキャッシュから読むが、こちらも policy を通ること
      internalCreateHTML.mockClear();
      const cached = new Layout();
      cached.setAttribute('src', '/layouts/tt.html');
      await cached.loadTemplate();
      expect(internalCreateHTML).toHaveBeenCalledWith('<main>from src</main>');
    });
  });
});

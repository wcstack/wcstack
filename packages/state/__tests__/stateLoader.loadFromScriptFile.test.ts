import { describe, it, expect } from 'vitest';
import { loadFromScriptFile, resolveAgainstDocument } from '../src/stateLoader/loadFromScriptFile';

describe('loadFromScriptFile', () => {
  it('data URLのモジュールを読み込めること', async () => {
    const code = 'export default { value: 123 }';
    const url = `data:text/javascript,${encodeURIComponent(code)}`;
    const data = await loadFromScriptFile(url);
    expect(data).toEqual({ value: 123 });
  });

  it('存在しないURLの場合は import() のエラーを包まずにそのまま reject すること', async () => {
    const error = await loadFromScriptFile('file:///not-found-module.js').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    // Was: a new "[@wcstack/state] Failed to load script file: …" Error with the original as text
    expect((error as Error).message).not.toMatch(/Failed to load script file/);
  });

  it('モジュール自身が投げた値をそのまま（同一オブジェクトで）reject すること', async () => {
    const probe = new TypeError('thrown by the module');
    (globalThis as any).__wcsLoaderProbe = probe;
    try {
      const url = `data:text/javascript,${encodeURIComponent('throw globalThis.__wcsLoaderProbe;')}`;
      await expect(loadFromScriptFile(url)).rejects.toBe(probe);
    } finally {
      delete (globalThis as any).__wcsLoaderProbe;
    }
  });

  it('モジュールが Error でない値（文字列）を投げても包まずに reject すること', async () => {
    const url = `data:text/javascript,${encodeURIComponent('throw "module threw a string";')}`;
    await expect(loadFromScriptFile(url)).rejects.toBe('module threw a string');
  });

  it('default が falsy の場合は空オブジェクトを返すこと', async () => {
    const code = 'export default 0';
    const url = `data:text/javascript,${encodeURIComponent(code)}`;
    const data = await loadFromScriptFile(url);
    expect(data).toEqual({});
  });

});

// `src` は HTML 属性なので document の base URL で解決されなければならない。
// 素の `import(url)` は「import を書いたモジュール」＝ state パッケージ自身を
// 基準にするため、CDN 一発で読み込んだページでは `src="/app.js"` が CDN 側の
// URL を指して 404 になる（`src="*.json"` 側は fetch が document 基準で解決して
// いたので、同じ属性が形式によって違う基準で解決されていた）。
describe('resolveAgainstDocument', () => {
  it('ルート相対パスを document の base URL で解決すること', () => {
    const origin = new URL(document.baseURI).origin;
    expect(resolveAgainstDocument('/app.js')).toBe(`${origin}/app.js`);
  });

  it('相対パスを document の base URL で解決すること', () => {
    expect(resolveAgainstDocument('./app.js')).toBe(new URL('./app.js', document.baseURI).href);
  });

  it('<base> があればそれに従うこと', () => {
    const base = document.createElement('base');
    base.setAttribute('href', '/ja/');
    document.head.appendChild(base);
    try {
      const origin = new URL(document.baseURI).origin;
      // ルート相対は base の影響を受けない / 相対は base 配下に落ちる
      expect(resolveAgainstDocument('/i18n/state.js')).toBe(`${origin}/i18n/state.js`);
      expect(resolveAgainstDocument('state.js')).toBe(`${origin}/ja/state.js`);
    } finally {
      base.remove();
    }
  });

  it('絶対 URL / data: は base 解決の影響を受けないこと', () => {
    expect(resolveAgainstDocument('https://example.invalid/absolute.js'))
      .toBe('https://example.invalid/absolute.js');
    expect(resolveAgainstDocument('data:text/javascript,export%20default%201'))
      .toBe('data:text/javascript,export%20default%201');
  });

});

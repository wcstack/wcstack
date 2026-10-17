import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToString } from '../src/render';

/**
 * `<wcs-state src>` をサーバーで描く（seam app ssr-news, 2026-10-18。著者の決定は
 * docs/v4-direction-2026-10.md §5.1）。Node のモジュールローダは http: の URL を読まないので、
 * `resolveModule` がページの URL をローカルのファイルへ写す。
 */
describe('renderToString — <wcs-state src>', () => {
  let dir: string;
  const bootstraps = () => [
    // state from src: the module resolver is this change's (the committed dist is the last release's)
    async () => (await import('../../state/src/exports')).bootstrapState(),
  ];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'wcs-state-src-'));
    mkdirSync(join(dir, 'js'));
    writeFileSync(join(dir, 'js', 'format.js'), `export const shout = (s) => s.toUpperCase();\n`);
    writeFileSync(join(dir, 'js', 'state.js'), [
      `import { shout } from "./format.js";`,
      `export default {`,
      `  title: shout("from a file"),`,
      `  visits: 0,`,
      `  $connectedCallback() { this.visits++; },`,
      `};`,
      ``,
    ].join('\n'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const page = `<wcs-state enable-ssr src="/js/state.js"></wcs-state><h1 data-wcs="textContent: title"></h1><p data-wcs="textContent: visits"></p>`;

  it('resolveModule が写したファイルから状態を読み、その中の相対 import も解決する', async () => {
    const html = await renderToString(page, {
      url: 'http://localhost:3000/articles/3',
      bootstraps: bootstraps(),
      resolveModule: (url) => join(dir, url.pathname),
    });
    expect(html).toContain('<h1 data-wcs="textContent: title">FROM A FILE</h1>');
    // src は出力に書いたまま（クライアントはブラウザの URL で読む）
    expect(html).toContain('src="/js/state.js"');
  });

  it('描画ごとに読み直すので、状態のオブジェクトはリクエストの間で共有されない', async () => {
    const options = () => ({ url: 'http://localhost:3000/', bootstraps: bootstraps(), resolveModule: (url: URL) => join(dir, url.pathname) });
    const first = await renderToString(page, options());
    const second = await renderToString(page, options());
    expect(first).toContain('<p data-wcs="textContent: visits">1</p>');
    expect(second).toContain('<p data-wcs="textContent: visits">1</p>');
  });

  it('resolveModule が無ければ、何をすればよいかを言って失敗する', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(renderToString(page, { url: 'http://localhost:3000/', bootstraps: bootstraps() })).rejects.toThrow(
        /<wcs-state src> names http:\/\/localhost:3000\/js\/state\.js, which Node cannot import .*Pass renderToString\(\{ resolveModule \}\)/,
      );
    } finally {
      error.mockRestore();
    }
  });

  it('resolveModule が何も返さない URL も、そう言って失敗する', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(renderToString(page, { url: 'http://localhost:3000/', bootstraps: bootstraps(), resolveModule: () => null })).rejects.toThrow(
        /resolveModule returned no file for it/,
      );
    } finally {
      error.mockRestore();
    }
  });
});

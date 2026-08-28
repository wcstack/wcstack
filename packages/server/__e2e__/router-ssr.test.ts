/**
 * SSR × router 結合テスト（docs/ssr-router-design.md Phase 1c）
 *
 * server 本体は router を知らない（プロトコル契約のみ）ため、実結合の検証は
 * CI matrix 外のこの e2e 層で行う。state / router は committed dist の鮮度に
 * 依存しないよう src を直接 import する（dist はリリース時にのみ再ビルドされる
 * ため、未リリースのプロトコル変更は dist 経由では見えない）。
 *
 * 1. サーバー側: renderToString() に url とルーター bootstrap を渡して HTML を生成
 * 2. 初期ルートの内容・バインディング適用・ハイドレーションマーカーを検証
 */
import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { renderToString } from '../src/render';

import { bootstrapState } from '../../state/src/exports';
import { bootstrapRouter } from '../../router/src/exports';

function parseResult(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}

const PAGE = `
  <wcs-state enable-ssr json='{"title":"Products Page"}'></wcs-state>
  <wcs-router enable-ssr>
    <template>
      <wcs-route path="/"><h1>Home</h1></wcs-route>
      <wcs-route path="/products">
        <h2 data-wcs="textContent: title">placeholder</h2>
      </wcs-route>
    </template>
  </wcs-router>
`;

describe('renderToString + router', () => {
  it('url で指定した初期ルートの内容が描画される', async () => {
    const result = await renderToString(PAGE, {
      url: 'http://localhost:3000/products',
      bootstraps: [bootstrapState, bootstrapRouter],
    });
    const doc = parseResult(result);
    const outlet = doc.querySelector('wcs-outlet');
    expect(outlet).not.toBeNull();
    expect(outlet!.querySelector('h2')).not.toBeNull();
    // マッチしないルートの内容は出力されない
    expect(outlet!.querySelector('h1')).toBeNull();
  });

  it('ルート内容の data-wcs バインディングが適用される（binder 経由）', async () => {
    const result = await renderToString(PAGE, {
      url: 'http://localhost:3000/products',
      bootstraps: [bootstrapState, bootstrapRouter],
    });
    const doc = parseResult(result);
    expect(doc.querySelector('wcs-outlet h2')?.textContent).toBe('Products Page');
  });

  it('template のルート定義が温存され、ハイドレーションマーカーが付く', async () => {
    const result = await renderToString(PAGE, {
      url: 'http://localhost:3000/products',
      bootstraps: [bootstrapState, bootstrapRouter],
    });
    const doc = parseResult(result);
    // クライアントが起動できる = template に全ルート定義が残っている
    const template = doc.querySelector('wcs-router template') as any;
    const routes = template.content.querySelectorAll('wcs-route');
    expect(routes.length).toBe(2);
    expect(routes[0].innerHTML).toContain('<h1>Home</h1>');
    // Phase 2 の入力: outlet マーカーとルート境界コメント
    const outlet = doc.querySelector('wcs-outlet')!;
    expect(outlet.hasAttribute('data-wcs-ssr')).toBe(true);
    expect(result).toContain('@@wcs-route-start:/products');
    expect(result).toContain('@@wcs-route-end:/products');
  });

  it('<wcs-ssr> の state スナップショットも同時に生成される', async () => {
    const result = await renderToString(PAGE, {
      url: 'http://localhost:3000/products',
      bootstraps: [bootstrapState, bootstrapRouter],
    });
    const doc = parseResult(result);
    const ssrEl = doc.querySelector('wcs-ssr');
    expect(ssrEl).not.toBeNull();
    const data = JSON.parse(
      ssrEl!.querySelector('script[type="application/json"]')?.textContent ?? '{}'
    );
    expect(data.title).toBe('Products Page');
  });

  it('ルートパス ("/") も描画できる', async () => {
    const result = await renderToString(PAGE, {
      url: 'http://localhost:3000/',
      bootstraps: [bootstrapState, bootstrapRouter],
    });
    const doc = parseResult(result);
    expect(doc.querySelector('wcs-outlet h1')?.textContent).toBe('Home');
    expect(doc.querySelector('wcs-outlet h2')).toBeNull();
  });

  it('型付きパラメータ付きのネストルートが描画できる', async () => {
    const result = await renderToString(`
      <wcs-router enable-ssr>
        <template>
          <wcs-route path="/products">
            <section>
              <wcs-route path=":id(int)"><h1>Detail</h1></wcs-route>
            </section>
          </wcs-route>
        </template>
      </wcs-router>
    `, {
      url: 'http://localhost:3000/products/42',
      bootstraps: [bootstrapState, bootstrapRouter],
    });
    const doc = parseResult(result);
    expect(doc.querySelector('wcs-outlet section h1')?.textContent).toBe('Detail');
    expect(result).toContain('@@wcs-route-start:/products/:id(int)');
  });

  it('guard 付きルートは描画されない（guard バリア）', async () => {
    const result = await renderToString(`
      <wcs-router enable-ssr>
        <template>
          <wcs-route path="/"><h1>Home</h1></wcs-route>
          <wcs-route path="/secret" guard="/"><h1>Secret</h1></wcs-route>
        </template>
      </wcs-router>
    `, {
      url: 'http://localhost:3000/secret',
      bootstraps: [bootstrapState, bootstrapRouter],
    });
    const doc = parseResult(result);
    // outlet には描画されない（template 内の定義は温存されるので全体検索はしない）
    const outlet = doc.querySelector('wcs-outlet')!;
    expect(outlet.querySelector('h1')).toBeNull();
    expect(outlet.hasAttribute('data-wcs-ssr')).toBe(false);
  });

  it('enable-ssr の無い router はサーバーで初期化されない（部分 CSR）', async () => {
    const result = await renderToString(`
      <wcs-router>
        <template>
          <wcs-route path="/"><h1>Home</h1></wcs-route>
        </template>
      </wcs-router>
    `, {
      url: 'http://localhost:3000/',
      bootstraps: [bootstrapState, bootstrapRouter],
    });
    const doc = parseResult(result);
    expect(doc.querySelector('wcs-outlet')).toBeNull();
    // template は消費されず、そのまま残る
    const template = doc.querySelector('wcs-router template') as any;
    expect(template.content.querySelector('wcs-route')?.innerHTML).toContain('<h1>Home</h1>');
  });
});

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

  it('SSR → クライアント採用のフルラウンドトリップ（state ハイドレーション込み）', async () => {
    // サーバー描画 → クライアント起動（このテスト環境の happy-dom）→
    // router がサーバー DOM を採用し、state のバインドが採用ノード上で生きている
    const ssrHtml = await renderToString(PAGE, {
      url: 'http://localhost:3000/products',
      bootstraps: [bootstrapState, bootstrapRouter],
    });

    // クライアント側の要素登録（renderToString 内の登録はレンダリング用
    // ウィンドウのレジストリに対して行われたもので、この環境には及ばない）
    bootstrapState();
    bootstrapRouter();

    // 実ブラウザの「パース完了 → define → upgrade」を happy-dom で再現するため
    // ラッパー div 経由で一括接続する。<base> はサーバー側で renderToString が
    // 注入したのと同じ条件（深い URL での basename 誤認防止）をクライアントにも作る
    const base = document.createElement('base');
    base.setAttribute('href', '/');
    document.head.appendChild(base);
    history.replaceState(null, '', '/products');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = ssrHtml;
    const h2Before = wrapper.querySelector('wcs-outlet h2');
    document.body.appendChild(wrapper);
    const routerEl = wrapper.querySelector('wcs-router') as any;
    await routerEl.connectedCallbackPromise;
    const stateEl = wrapper.querySelector('wcs-state') as any;
    await stateEl.connectedCallbackPromise;
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      // 採用: 再描画されず、サーバーのノードがそのまま残る
      const h2 = document.querySelector('wcs-outlet h2')!;
      expect(h2).toBe(h2Before);
      expect(h2.textContent).toBe('Products Page');
      expect(document.querySelectorAll('wcs-outlet h2').length).toBe(1);
      expect(document.querySelector('wcs-outlet')!.hasAttribute('data-wcs-ssr')).toBe(false);

      // 採用ノードのバインドが生きている: state の変更が DOM に反映される
      stateEl.createState('writable', (state: any) => {
        state.title = 'Updated Title';
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(h2.textContent).toBe('Updated Title');
    } finally {
      wrapper.remove();
      base.remove();
      history.replaceState(null, '', '/');
    }
  });

  it('orchestrated: route 内容の構造テンプレートが <wcs-ssr> に載る（json 属性 state のレース解消）', async () => {
    // Phase 3（docs/ssr-router-design.md §5）の本丸。json 属性 state は I/O 無しで
    // 初回バインド構築が router の挿入より先に完了し得るため、inline 生成では
    // route 内の for テンプレートがスナップショットに載るかが順序次第だった。
    // orchestrated（bootstrapState が builder を登録 → renderToString が最終パスで
    // 生成）では常に載る。
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"items":[{"name":"Alice"},{"name":"Bob"}]}'></wcs-state>
      <wcs-router enable-ssr>
        <template>
          <wcs-route path="/">
            <ul>
              <template data-wcs="for: items">
                <li data-wcs="textContent: .name"></li>
              </template>
            </ul>
          </wcs-route>
        </template>
      </wcs-router>
    `, {
      url: 'http://localhost:3000/',
      bootstraps: [bootstrapState, bootstrapRouter],
    });
    const doc = parseResult(result);
    // orchestrated が宣言され、レンダリング済み HTML にリストが展開されている
    expect(doc.querySelectorAll('wcs-outlet li').length).toBe(2);
    // スナップショットに route 内容の構造テンプレートが載っている
    const ssrEl = doc.querySelector('wcs-ssr');
    expect(ssrEl).not.toBeNull();
    const tpl = ssrEl!.querySelector('template[id]');
    expect(tpl).not.toBeNull();
    expect(tpl!.innerHTML).toContain('data-wcs');
    // wcs-ssr は 1 つだけ（inline 生成との二重生成が起きていない）
    expect(doc.querySelectorAll('wcs-ssr').length).toBe(1);
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

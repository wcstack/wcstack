import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Router } from '../src/components/Router';
import * as applyRouteModule from '../src/applyRoute';
import './setup';

// SSR ハイドレーション = クライアント採用（docs/ssr-router-design.md §4）。
// サーバー描画（data-wcs-server 下）→ シリアライズ → クライアント起動の
// ラウンドトリップを happy-dom 内で再現する。
//
// clientBoot がラッパー div 経由で一括接続するのは実ブラウザの前提を作るため:
// 実ブラウザは「パース完了 → deferred script が define → upgrade」の順で全 DOM が
// 揃った状態から connectedCallback が走る。happy-dom は接続時点で cc を呼ぶので、
// 部分的に接続すると router から outlet が見えない・Link から router が見えない
// という実環境には無い順序が生まれる。

const PENDING_KEY = Symbol.for('wcstack.binder.pending');

function pendingQueue(): Node[] {
  const globals = globalThis as Record<symbol, unknown>;
  let queue = globals[PENDING_KEY] as Node[] | undefined;
  if (queue === undefined) {
    queue = [];
    globals[PENDING_KEY] = queue;
  }
  return queue;
}

/**
 * body を空にする。先に anchor を単独で外すのは happy-dom の制約回避:
 * 実ブラウザではカスタム要素 reaction は DOM 操作の完了後に走るが、happy-dom は
 * 切断カスケードの最中に disconnectedCallback を同期で呼ぶ。Link の
 * disconnectedCallback は自分の anchor を除去するため、カスケード中の子配列
 * 走査が壊れて TypeError になる。anchor を先に detach しておけば Link 側の
 * remove() は no-op になり、カスケードは無傷で完走する。
 */
function clearBody(): void {
  document.querySelectorAll('a').forEach((anchor) => anchor.remove());
  document.body.innerHTML = '';
}

function setUrl(path: string): void {
  history.replaceState(null, '', path);
}

function addBase(href = '/'): void {
  const base = document.createElement('base');
  base.setAttribute('href', href);
  document.head.appendChild(base);
}

async function serverRender(inner: string, urlPath: string): Promise<string> {
  document.documentElement.setAttribute('data-wcs-server', '');
  setUrl(urlPath);
  const router = document.createElement('wcs-router') as Router;
  router.setAttribute('enable-ssr', '');
  router.innerHTML = inner;
  document.body.appendChild(router);
  await router.connectedCallbackPromise;
  const html = document.body.innerHTML;
  clearBody();
  document.documentElement.removeAttribute('data-wcs-server');
  return html;
}

async function clientBoot(html: string): Promise<Router> {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  const router = wrapper.querySelector('wcs-router') as Router;
  await router.connectedCallbackPromise;
  return router;
}

function outletComments(): string[] {
  const outlet = document.querySelector('wcs-outlet')!;
  const comments: string[] = [];
  const walker = document.createTreeWalker(outlet, NodeFilter.SHOW_COMMENT);
  while (walker.nextNode()) {
    comments.push((walker.currentNode as Comment).data);
  }
  return comments;
}

// 静的コメント（<!--note-->）はマーカー走査の「マーカー以外のコメント」経路の検証
const BASIC = `
  <template>
    <wcs-route path="/"><h1>Home</h1></wcs-route>
    <!--note-->
    <wcs-route path="/about"><h2>About</h2></wcs-route>
  </template>
`;

const NESTED = `
  <template>
    <wcs-route path="/"><h1>Home</h1></wcs-route>
    <wcs-route path="/products">
      <section>
        <wcs-route path=":id(int)" name="product-detail"><h1>Detail</h1></wcs-route>
      </section>
    </wcs-route>
  </template>
`;

describe('SSR ハイドレーション（クライアント採用）', () => {
  beforeEach(() => {
    clearBody();
    document.documentElement.removeAttribute('data-wcs-server');
    setUrl('/');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-wcs-server');
    document.head.querySelectorAll('base').forEach((base) => base.remove());
    pendingQueue().length = 0;
    setUrl('/');
    vi.restoreAllMocks();
  });

  it('サーバー描画済み DOM を再描画せずに採用すること（同一ノード）', async () => {
    const html = await serverRender(BASIC, '/');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const h1Before = wrapper.querySelector('h1');
    document.body.appendChild(wrapper);
    const router = wrapper.querySelector('wcs-router') as Router;
    await router.connectedCallbackPromise;
    // 内容は 1 つだけ・サーバーのノードそのもの
    expect(document.querySelectorAll('h1').length).toBe(1);
    expect(document.querySelector('h1')).toBe(h1Before);
    // マーカー・目印は撤去される
    expect(document.querySelector('wcs-outlet')!.hasAttribute('data-wcs-ssr')).toBe(false);
    expect(outletComments().some((data) => data.startsWith('@@wcs-route-'))).toBe(false);
    // a11y region はクライアント側で生成される
    expect(router.a11yRegion).not.toBeNull();
  });

  it('採用後に観測面（path / params / searchParams / routeName）が commit されること', async () => {
    addBase('/');
    const html = await serverRender(NESTED, '/products/42?page=2');
    setUrl('/products/42?page=2');
    const router = await clientBoot(html);
    expect(router.path).toBe('/products/42');
    expect(router.params).toEqual({ id: '42' });
    expect(router.typedParams).toEqual({ id: 42 });
    expect(router.searchParams).toEqual({ page: '2' });
    expect(router.routeName).toBe('product-detail');
  });

  it('採用後のナビゲーションが従来どおり動くこと（hide → show の往復）', async () => {
    const html = await serverRender(BASIC, '/');
    const router = await clientBoot(html);
    const adopted = document.querySelector('h1');
    await router.navigate('/about');
    expect(document.querySelector('h1')).toBeNull();
    expect(document.querySelector('h2')?.textContent).toBe('About');
    await router.navigate('/');
    // 採用ノードがそのまま戻る
    expect(document.querySelector('h1')).toBe(adopted);
    expect(document.querySelector('h2')).toBeNull();
  });

  it('ネストルートの採用が成立すること', async () => {
    addBase('/');
    const html = await serverRender(NESTED, '/products/7');
    setUrl('/products/7');
    const router = await clientBoot(html);
    expect(document.querySelectorAll('h1').length).toBe(1);
    expect(document.querySelector('section h1')?.textContent).toBe('Detail');
    // 親→子の順で hide / show が成立する（子内容は子が所有）
    await router.navigate('/');
    expect(document.querySelector('section')).toBeNull();
    expect(document.querySelector('h1')?.textContent).toBe('Home');
  });

  it('親直下の子ルート（ラッパー無し）でも採用が成立すること', async () => {
    // 子のマーカー範囲が親の兄弟走査に現れる形 — 親の childNodeArray から
    // 子の範囲（マーカーと内容）が丸ごと除外されることを hide/show の往復で検証
    const direct = `
      <template>
        <wcs-route path="/"><h1>Home</h1></wcs-route>
        <wcs-route path="/products"><p>list</p><wcs-route path=":id(int)"><h1>Detail</h1></wcs-route></wcs-route>
      </template>
    `;
    addBase('/');
    const html = await serverRender(direct, '/products/7');
    setUrl('/products/7');
    const router = await clientBoot(html);
    expect(document.querySelectorAll('h1').length).toBe(1);
    expect(document.querySelector('h1')?.textContent).toBe('Detail');
    expect(document.querySelector('p')?.textContent).toBe('list');
    await router.navigate('/');
    expect(document.querySelector('p')).toBeNull();
    expect(document.querySelector('h1')?.textContent).toBe('Home');
    await router.navigate('/products/7');
    expect(document.querySelectorAll('h1').length).toBe(1);
    expect(document.querySelector('h1')?.textContent).toBe('Detail');
    expect(document.querySelectorAll('p').length).toBe(1);
  });

  it('親の範囲内に子の範囲が入れ子で書かれた SSR HTML も採用できること', async () => {
    // 自前のサーバーは子の範囲を親の範囲の外（隣接）に置くが、範囲の入れ子は
    // 検証（交差チェック）が許す正しい形 — 他システム由来の SSR HTML を模す。
    // 親の内容収集が子の範囲（マーカーと内容）を丸ごと除外することの検証
    const html = `
      <wcs-router enable-ssr>
        <template>
          <wcs-route path="/"><h1>Home</h1></wcs-route>
          <wcs-route path="/products"><p>list</p><wcs-route path=":id(int)"><h1>Detail</h1></wcs-route></wcs-route>
        </template>
      </wcs-router>
      <wcs-outlet data-wcs-ssr="">
        <!--@@wcs-route-ph:/-->
        <!--@@wcs-route-ph:/products--><!--@@wcs-route-start:/products--><p>list</p><!--@@wcs-route-ph:/products/:id(int)--><!--@@wcs-route-start:/products/:id(int)--><h1>Detail</h1><!--@@wcs-route-end:/products/:id(int)--><!--@@wcs-route-end:/products-->
      </wcs-outlet>
    `;
    addBase('/');
    setUrl('/products/7');
    const router = await clientBoot(html);
    expect(document.querySelectorAll('h1').length).toBe(1);
    expect(document.querySelector('h1')?.textContent).toBe('Detail');
    // 子の内容は親の childNodeArray に入らない — 往復しても重複しない
    await router.navigate('/');
    expect(document.querySelector('p')).toBeNull();
    expect(document.querySelector('h1')?.textContent).toBe('Home');
    await router.navigate('/products/7');
    expect(document.querySelectorAll('h1').length).toBe(1);
    expect(document.querySelectorAll('p').length).toBe(1);
  });

  it('同一親で範囲が交差する手書き SSR HTML はフォールバックすること', async () => {
    // ネスト経由の交差は親違いの検査に先に引っかかるため、同一親の交差を手書きで作る
    const html = `
      <wcs-router enable-ssr>
        <template>
          <wcs-route path="/"><h1>Home</h1></wcs-route>
          <wcs-route path="/products"><p>list</p><wcs-route path=":id(int)"><h1>Detail</h1></wcs-route></wcs-route>
        </template>
      </wcs-router>
      <wcs-outlet data-wcs-ssr="">
        <!--@@wcs-route-ph:/-->
        <!--@@wcs-route-ph:/products--><!--@@wcs-route-ph:/products/:id(int)--><!--@@wcs-route-start:/products--><p>list</p><!--@@wcs-route-start:/products/:id(int)--><!--@@wcs-route-end:/products--><h1>Detail</h1><!--@@wcs-route-end:/products/:id(int)-->
      </wcs-outlet>
    `;
    addBase('/');
    setUrl('/products/7');
    await clientBoot(html);
    // フォールバックで描き直される
    expect(document.querySelectorAll('h1').length).toBe(1);
    expect(document.querySelector('h1')?.textContent).toBe('Detail');
    expect(document.querySelector('wcs-outlet')!.hasAttribute('data-wcs-ssr')).toBe(false);
  });

  it('placeholder 集合が要求（トップレベル + マッチルートの子）と食い違えばフォールバックすること', async () => {
    addBase('/');
    const html = await serverRender(NESTED, '/');
    // 数は同じだが、非活性ルートの子孫（/products/:id(int)）の ph に差し替える —
    // これを許すと fresh クローンから placeholder を奪って当該ルートが到達不能になる
    const broken = html.replace(
      '<!--@@wcs-route-ph:/products-->',
      '<!--@@wcs-route-ph:/products/:id(int)-->'
    );
    await clientBoot(broken);
    expect(document.querySelector('h1')?.textContent).toBe('Home');
    expect(document.querySelector('wcs-outlet')!.hasAttribute('data-wcs-ssr')).toBe(false);
  });

  it('URL がサーバー描画時と違う場合はフォールバックして描き直すこと', async () => {
    const html = await serverRender(BASIC, '/about');
    setUrl('/');
    await clientBoot(html);
    // マッチ集合とマーカー集合の不一致 → 破棄して現在 URL で描画
    expect(document.querySelector('h1')?.textContent).toBe('Home');
    expect(document.querySelector('h2')).toBeNull();
    expect(document.querySelector('wcs-outlet')!.hasAttribute('data-wcs-ssr')).toBe(false);
    // 描き直しの内容は binder へ差し出される（state が先にハイドレート済みでも拾える）
    const offered = pendingQueue().some(
      (node) => node.nodeType === 1 && (node as Element).outerHTML.includes('Home')
    );
    expect(offered).toBe(true);
  });

  it('マーカー数の不一致（ネスト → 単一）でもフォールバックすること', async () => {
    addBase('/');
    const html = await serverRender(NESTED, '/products/7');
    setUrl('/');
    await clientBoot(html);
    expect(document.querySelector('h1')?.textContent).toBe('Home');
    expect(document.querySelector('section')).toBeNull();
  });

  it('end マーカー欠損はフォールバックすること', async () => {
    const html = await serverRender(BASIC, '/');
    const broken = html.replace('<!--@@wcs-route-end:/-->', '');
    await clientBoot(broken);
    expect(document.querySelectorAll('h1').length).toBe(1);
    expect(document.querySelector('wcs-outlet')!.hasAttribute('data-wcs-ssr')).toBe(false);
  });

  it('start と end の順序逆転はフォールバックすること', async () => {
    const html = await serverRender(BASIC, '/');
    const swapped = html
      .replace('<!--@@wcs-route-start:/-->', 'TMP_MARKER')
      .replace('<!--@@wcs-route-end:/-->', '<!--@@wcs-route-start:/-->')
      .replace('TMP_MARKER', '<!--@@wcs-route-end:/-->');
    await clientBoot(swapped);
    expect(document.querySelectorAll('h1').length).toBe(1);
  });

  it('start と end の親が異なる場合はフォールバックすること', async () => {
    const html = await serverRender(BASIC, '/');
    const broken = html.replace(
      '<!--@@wcs-route-end:/-->',
      '<div><!--@@wcs-route-end:/--></div>'
    );
    await clientBoot(broken);
    expect(document.querySelectorAll('h1').length).toBe(1);
  });

  it('対応する start の無い end キーはフォールバックすること', async () => {
    const html = await serverRender(BASIC, '/');
    const broken = html.replace('<!--@@wcs-route-end:/-->', '<!--@@wcs-route-end:/about-->');
    await clientBoot(broken);
    expect(document.querySelectorAll('h1').length).toBe(1);
  });

  it('未知キーの start マーカーはフォールバックすること', async () => {
    const html = await serverRender(BASIC, '/');
    const broken = html.replace(
      '<!--@@wcs-route-start:/-->',
      '<!--@@wcs-route-start:/nope--><!--@@wcs-route-start:/-->'
    );
    await clientBoot(broken);
    expect(document.querySelectorAll('h1').length).toBe(1);
  });

  it('未知キーの end マーカーはフォールバックすること', async () => {
    const html = await serverRender(BASIC, '/');
    const broken = html.replace(
      '<!--@@wcs-route-end:/-->',
      '<!--@@wcs-route-end:/--><!--@@wcs-route-end:/nope-->'
    );
    await clientBoot(broken);
    expect(document.querySelectorAll('h1').length).toBe(1);
  });

  it('placeholder コメントの重複はフォールバックすること', async () => {
    const html = await serverRender(BASIC, '/');
    const broken = html.replace(
      '<!--@@wcs-route-ph:/about-->',
      '<!--@@wcs-route-ph:/about--><!--@@wcs-route-ph:/about-->'
    );
    await clientBoot(broken);
    expect(document.querySelectorAll('h1').length).toBe(1);
  });

  it('マッチルートの placeholder 欠損はフォールバックすること', async () => {
    const html = await serverRender(BASIC, '/');
    const broken = html.replace('<!--@@wcs-route-ph:/-->', '');
    await clientBoot(broken);
    expect(document.querySelectorAll('h1').length).toBe(1);
  });

  it('範囲が交差するマーカーはフォールバックすること', async () => {
    addBase('/');
    const html = await serverRender(NESTED, '/products/7');
    setUrl('/products/7');
    const crossed = html
      .replace('<!--@@wcs-route-end:/products/:id(int)-->', 'TMP_MARKER')
      .replace('<!--@@wcs-route-end:/products-->', '<!--@@wcs-route-end:/products/:id(int)-->')
      .replace('TMP_MARKER', '<!--@@wcs-route-end:/products-->');
    await clientBoot(crossed);
    expect(document.querySelectorAll('h1').length).toBe(1);
    expect(document.querySelector('section h1')?.textContent).toBe('Detail');
  });

  it('absolutePath が重複するルート定義はフォールバックすること', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dup = `
      <template>
        <wcs-route path="/"><h1>Home</h1></wcs-route>
        <wcs-route path="/"><h1>Dup</h1></wcs-route>
      </template>
    `;
    const html = await serverRender(dup, '/');
    await clientBoot(html);
    expect(document.querySelectorAll('h1').length).toBe(1);
  });

  it('layout outlet を含むサーバー DOM はフォールバックすること', async () => {
    const html = await serverRender(BASIC, '/');
    const withLayout = html.replace(
      '<!--@@wcs-route-ph:/-->',
      '<wcs-layout-outlet></wcs-layout-outlet><!--@@wcs-route-ph:/-->'
    );
    await clientBoot(withLayout);
    expect(document.querySelectorAll('h1').length).toBe(1);
    // 破棄されるので layout outlet は残らない
    expect(document.querySelector('wcs-outlet wcs-layout-outlet')).toBeNull();
  });

  it('マッチ無し・fallback ルート無しはフォールバックして通常経路に任せること', async () => {
    const html = await serverRender(BASIC, '/');
    addBase('/');
    setUrl('/nowhere');
    const applySpy = vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(true);
    await clientBoot(html);
    // 採用は成立せず、通常経路（applyRoute — ここでは loud failure する側）へ落ちる
    expect(applySpy).toHaveBeenCalled();
    expect(document.querySelector('wcs-outlet')!.hasAttribute('data-wcs-ssr')).toBe(false);
  });

  it('マッチ無しでも fallback ルートがあれば描き直しで表示されること', async () => {
    const withFallback = `
      <template>
        <wcs-route path="/"><h1>Home</h1></wcs-route>
        <wcs-route fallback><h1>Not Found</h1></wcs-route>
      </template>
    `;
    const html = await serverRender(withFallback, '/');
    addBase('/');
    setUrl('/nowhere');
    await clientBoot(html);
    // マーカー集合（/）と fallback マッチの不一致 → 破棄して fallback を描画
    expect(document.querySelector('h1')?.textContent).toBe('Not Found');
  });
});

describe('SSR ハイドレーション（Link の採用）', () => {
  beforeEach(() => {
    clearBody();
    document.documentElement.removeAttribute('data-wcs-server');
    setUrl('/');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-wcs-server');
    document.head.querySelectorAll('base').forEach((base) => base.remove());
    pendingQueue().length = 0;
    setUrl('/');
    vi.restoreAllMocks();
  });

  const WITH_LINK = `
    <template>
      <wcs-route path="/">
        <h1>Home</h1>
        <wcs-link to="/about">About</wcs-link>
      </wcs-route>
      <wcs-route path="/about"><h2>About</h2></wcs-route>
    </template>
  `;

  it('サーバーが生成した anchor に目印が付き、active 状態が載ること', async () => {
    const html = await serverRender(WITH_LINK, '/');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const anchor = wrapper.querySelector('a')!;
    expect(anchor.hasAttribute('data-wcs-ssr-link')).toBe(true);
    expect(anchor.getAttribute('href')).toBe('/about');
    expect(anchor.textContent).toBe('About');
    // active 判定もサーバー出力に載る（/ ページのリンクは /about なので非 active）
    expect(anchor.classList.contains('active')).toBe(false);
  });

  it('クライアントが anchor を採用して二重生成しないこと', async () => {
    const html = await serverRender(WITH_LINK, '/');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const anchorBefore = wrapper.querySelector('a');
    document.body.appendChild(wrapper);
    const router = wrapper.querySelector('wcs-router') as Router;
    await router.connectedCallbackPromise;
    const anchors = document.querySelectorAll('a');
    expect(anchors.length).toBe(1);
    expect(anchors[0]).toBe(anchorBefore);
    expect(anchors[0].hasAttribute('data-wcs-ssr-link')).toBe(false);
    expect(anchors[0].textContent).toBe('About');
  });

  it('採用後の hide → show でも anchor が重複しないこと', async () => {
    const html = await serverRender(WITH_LINK, '/');
    const router = await clientBoot(html);
    await router.navigate('/about');
    // Link は route 内容と一緒に退場する（anchor は Link の所有物として除去）
    expect(document.querySelectorAll('a').length).toBe(0);
    await router.navigate('/');
    expect(document.querySelectorAll('a').length).toBe(1);
    expect(document.querySelector('a')?.textContent).toBe('About');
  });

  it('outlet 外の静的 Link も採用されること', async () => {
    const staticLink = `
      <wcs-link to="/">Top</wcs-link>
      <wcs-router enable-ssr>
        <template><wcs-route path="/"><h1>Home</h1></wcs-route></template>
      </wcs-router>
    `;
    document.documentElement.setAttribute('data-wcs-server', '');
    setUrl('/');
    document.body.innerHTML = staticLink;
    const serverRouter = document.querySelector('wcs-router') as Router;
    await serverRouter.connectedCallbackPromise;
    const html = document.body.innerHTML;
    clearBody();
    document.documentElement.removeAttribute('data-wcs-server');

    // サーバー出力: 静的 Link の anchor（目印付き・active）
    expect(html).toContain('data-wcs-ssr-link');
    await clientBoot(html);
    const anchors = document.querySelectorAll('a');
    expect(anchors.length).toBe(1);
    expect(anchors[0].hasAttribute('data-wcs-ssr-link')).toBe(false);
    expect(anchors[0].textContent).toBe('Top');
    expect(anchors[0].classList.contains('active')).toBe(true);
  });

  it('SSR 中に接続直後へ切断された Link は anchor を作らないこと', async () => {
    document.documentElement.setAttribute('data-wcs-server', '');
    const link = document.createElement('wcs-link');
    link.setAttribute('to', '/x');
    link.textContent = 'gone';
    document.body.appendChild(link);
    link.remove();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('a')).toBeNull();
  });
});

describe('SSR ハイドレーション（guard 防衛経路）', () => {
  beforeEach(() => {
    clearBody();
    document.documentElement.removeAttribute('data-wcs-server');
    setUrl('/');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-wcs-server');
    document.head.querySelectorAll('base').forEach((base) => base.remove());
    setUrl('/');
    vi.restoreAllMocks();
  });

  it('採用後も guard は実行され、拒否なら fallback へ遷移して採用内容を隠すこと', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 自前のサーバーは guard 付きを描かない（§2-4）ため、他システム由来の
    // SSR HTML を模して手書きする — 採用は認可をスキップしない検証（§4-3）
    const html = `
      <wcs-router enable-ssr>
        <template>
          <wcs-route path="/secret" guard="/"><h1>Secret</h1></wcs-route>
          <wcs-guard-handler><script type="module">export default () => false;</script></wcs-guard-handler>
          <wcs-route path="/"><h2>Home</h2></wcs-route>
        </template>
      </wcs-router>
      <wcs-outlet data-wcs-ssr="">
        <!--@@wcs-route-ph:/secret--><!--@@wcs-route-start:/secret--><h1>Secret</h1><!--@@wcs-route-end:/secret-->
        <!--@@wcs-route-ph:/-->
      </wcs-outlet>
    `;
    addBase('/');
    setUrl('/secret');
    const router = await clientBoot(html);
    // guard の拒否 → microtask で fallback（"/"）への遷移が予約される
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector('h1')).toBeNull();
    expect(document.querySelector('h2')?.textContent).toBe('Home');
    expect(router.path).toBe('/');
  });
});

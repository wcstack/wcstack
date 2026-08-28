import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Router } from '../src/components/Router';
import { inSsr } from '../src/inSsr';
import './setup';

// SSR モード（docs/ssr-router-design.md §3.2）のユニットテスト。
// @wcstack/server との実結合は packages/server/__e2e__ 側（CI matrix 外）で検証し、
// ここでは data-wcs-server 属性を立てて router 単体の SSR モード挙動を検証する。

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

function setUrl(path: string): void {
  history.replaceState(null, '', path);
}

function addBase(href = '/'): void {
  const base = document.createElement('base');
  base.setAttribute('href', href);
  document.head.appendChild(base);
}

async function mountRouter(innerHTML: string, attrs: Record<string, string> = {}): Promise<Router> {
  const router = document.createElement('wcs-router') as Router;
  for (const [key, value] of Object.entries(attrs)) {
    router.setAttribute(key, value);
  }
  router.innerHTML = innerHTML;
  document.body.appendChild(router);
  await router.connectedCallbackPromise;
  return router;
}

describe('SSR モード', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.setAttribute('data-wcs-server', '');
    setUrl('/');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-wcs-server');
    document.head.querySelectorAll('base').forEach((base) => base.remove());
    pendingQueue().length = 0;
    setUrl('/');
    vi.restoreAllMocks();
  });

  it('inSsr が data-wcs-server 属性で判定されること', () => {
    expect(inSsr()).toBe(true);
    document.documentElement.removeAttribute('data-wcs-server');
    expect(inSsr()).toBe(false);
  });

  it('待機プロトコルを宣言していること', () => {
    expect(Router.hasConnectedCallbackPromise).toBe(true);
    const router = document.createElement('wcs-router') as Router;
    expect(router.connectedCallbackPromise).toBeInstanceOf(Promise);
  });

  it('enable-ssr 無しではサーバーで初期化されないこと（部分 CSR）', async () => {
    const router = await mountRouter(`
      <template><wcs-route path="/"><h1>Home</h1></wcs-route></template>
    `);
    // 初期化されない = outlet が生成されない・template も消費されない
    expect(document.querySelector('wcs-outlet')).toBeNull();
    expect(() => router.outlet).toThrow();
    const template = router.querySelector('template')!;
    expect(template.content.querySelector('wcs-route')?.innerHTML).toContain('<h1>Home</h1>');
  });

  it('enable-ssr ありで初期ルートの内容が outlet に描画されること', async () => {
    await mountRouter(`
      <template><wcs-route path="/"><h1>Home</h1></wcs-route></template>
    `, { 'enable-ssr': '' });
    const outlet = document.querySelector('wcs-outlet');
    expect(outlet).not.toBeNull();
    expect(outlet!.querySelector('h1')?.textContent).toBe('Home');
  });

  it('template のルート定義が温存されること（parse の破壊的消費から復元）', async () => {
    const router = await mountRouter(`
      <template>
        <wcs-route path="/"><h1>Home</h1></wcs-route>
        <wcs-route path="/about"><h2>About</h2></wcs-route>
      </template>
    `, { 'enable-ssr': '' });
    const content = router.template.content;
    const routes = content.querySelectorAll('wcs-route');
    expect(routes.length).toBe(2);
    expect(routes[0].innerHTML).toContain('<h1>Home</h1>');
    expect(routes[1].innerHTML).toContain('<h2>About</h2>');
  });

  it('a11y live region が作られないこと', async () => {
    const router = await mountRouter(`
      <template><wcs-route path="/"><h1>Home</h1></wcs-route></template>
    `, { 'enable-ssr': '' });
    expect(router.a11yRegion).toBeNull();
    expect(router.querySelector('[role="status"]')).toBeNull();
  });

  it('outlet に data-wcs-ssr 属性とルート境界マーカーが付くこと', async () => {
    await mountRouter(`
      <template><wcs-route path="/"><h1>Home</h1></wcs-route></template>
    `, { 'enable-ssr': '' });
    const outlet = document.querySelector('wcs-outlet')!;
    expect(outlet.hasAttribute('data-wcs-ssr')).toBe(true);
    const comments: string[] = [];
    const walker = document.createTreeWalker(outlet, NodeFilter.SHOW_COMMENT);
    while (walker.nextNode()) {
      comments.push((walker.currentNode as Comment).data);
    }
    expect(comments).toContain('@@wcs-route-start:/');
    expect(comments).toContain('@@wcs-route-end:/');
    // マーカーは内容を挟む（start がコンテンツより前、end が後）
    const html = outlet.innerHTML;
    expect(html.indexOf('@@wcs-route-start:/')).toBeLessThan(html.indexOf('<h1>'));
    expect(html.indexOf('<h1>')).toBeLessThan(html.indexOf('@@wcs-route-end:/'));
  });

  it('ネストしたルートのマーカーが入れ子で付くこと', async () => {
    setUrl('/products/1');
    addBase('/');
    await mountRouter(`
      <template>
        <wcs-route path="/products">
          <section>
            <wcs-route path=":id(int)"><h1>Detail</h1></wcs-route>
          </section>
        </wcs-route>
      </template>
    `, { 'enable-ssr': '' });
    const outlet = document.querySelector('wcs-outlet')!;
    expect(outlet.querySelector('h1')?.textContent).toBe('Detail');
    // コメントを文書順で収集し、厳密一致で順序を検証する
    // （文字列 indexOf は "/products" が "/products/:id(int)" の接頭辞のため使えない）
    const comments: string[] = [];
    const walker = document.createTreeWalker(outlet, NodeFilter.SHOW_COMMENT);
    while (walker.nextNode()) {
      comments.push((walker.currentNode as Comment).data);
    }
    expect(comments).toContain('@@wcs-route-start:/products');
    expect(comments).toContain('@@wcs-route-start:/products/:id(int)');
    expect(comments).toContain('@@wcs-route-end:/products/:id(int)');
    expect(comments).toContain('@@wcs-route-end:/products');
    // 子のマーカーは親のマーカー内に収まる
    expect(comments.indexOf('@@wcs-route-start:/products')).toBeLessThan(
      comments.indexOf('@@wcs-route-start:/products/:id(int)')
    );
    expect(comments.indexOf('@@wcs-route-end:/products/:id(int)')).toBeLessThan(
      comments.indexOf('@@wcs-route-end:/products')
    );
  });

  it('guard 付きルートがマッチに含まれる場合は描画しないこと（guard バリア）', async () => {
    const router = await mountRouter(`
      <template><wcs-route path="/" guard="/login"><h1>Secret</h1></wcs-route></template>
    `, { 'enable-ssr': '' });
    const outlet = document.querySelector('wcs-outlet')!;
    expect(outlet.querySelector('h1')).toBeNull();
    expect(outlet.hasAttribute('data-wcs-ssr')).toBe(false);
    // 初期化自体は完了している（クライアントが従来どおり描く前提の空出力）
    expect((router as any)._initialized).toBe(true);
  });

  it('ルート内容が binder プロトコルへ差し出されること', async () => {
    // binder 不在なので保留キューに載る（state が居れば構築末尾で引き取られる）
    await mountRouter(`
      <template><wcs-route path="/"><h1>Home</h1></wcs-route></template>
    `, { 'enable-ssr': '' });
    const queue = pendingQueue();
    const offered = queue.some(
      (node) => node.nodeType === 1 && (node as Element).outerHTML.includes('Home')
    );
    expect(offered).toBe(true);
  });

  it('ナビゲーションリスナを登録しないこと', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    await mountRouter(`
      <template><wcs-route path="/"><h1>Home</h1></wcs-route></template>
    `, { 'enable-ssr': '' });
    const popstateCalls = addSpy.mock.calls.filter(([type]) => type === 'popstate');
    expect(popstateCalls.length).toBe(0);
  });

  it('マッチ無し・fallback 無しの場合は loud failure になること', async () => {
    setUrl('/nowhere');
    addBase('/');
    const router = document.createElement('wcs-router') as Router;
    router.setAttribute('enable-ssr', '');
    router.innerHTML = `<template><wcs-route path="/"><h1>Home</h1></wcs-route></template>`;
    document.body.appendChild(router);
    await expect(router.connectedCallbackPromise).rejects.toThrow('No route matched');
  });

  it('マッチ無しでも fallback ルートがあれば描画されること', async () => {
    setUrl('/nowhere');
    addBase('/');
    await mountRouter(`
      <template>
        <wcs-route path="/"><h1>Home</h1></wcs-route>
        <wcs-route fallback><h1>Not Found</h1></wcs-route>
      </template>
    `, { 'enable-ssr': '' });
    const outlet = document.querySelector('wcs-outlet')!;
    expect(outlet.querySelector('h1')?.textContent).toBe('Not Found');
    expect(outlet.hasAttribute('data-wcs-ssr')).toBe(true);
  });

  it('子ノードを持たないルートでもマーカーが付くこと', async () => {
    await mountRouter(`
      <template><wcs-route path="/"></wcs-route></template>
    `, { 'enable-ssr': '' });
    const outlet = document.querySelector('wcs-outlet')!;
    const comments: string[] = [];
    const walker = document.createTreeWalker(outlet, NodeFilter.SHOW_COMMENT);
    while (walker.nextNode()) {
      comments.push((walker.currentNode as Comment).data);
    }
    expect(comments).toContain('@@wcs-route-start:/');
    expect(comments).toContain('@@wcs-route-end:/');
    expect(comments.indexOf('@@wcs-route-start:/')).toBeLessThan(
      comments.indexOf('@@wcs-route-end:/')
    );
  });

  it('documentElement が無い場合 inSsr は false を返すこと', () => {
    const html = document.documentElement;
    html.remove();
    try {
      expect(inSsr()).toBe(false);
    } finally {
      document.appendChild(html);
    }
  });

  it('初期化が throw した場合 connectedCallbackPromise が reject されること', async () => {
    // ルート定義の無い template → _initialize が raiseError する
    const router = document.createElement('wcs-router') as Router;
    router.setAttribute('enable-ssr', '');
    router.innerHTML = `<template><div>no routes</div></template>`;
    document.body.appendChild(router);
    await expect(router.connectedCallbackPromise).rejects.toThrow('has no route definitions');
  });
});

describe('非 SSR モードの待機プロトコル', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-wcs-server');
    history.replaceState(null, '', '/');
  });

  afterEach(() => {
    document.head.querySelectorAll('base').forEach((base) => base.remove());
    vi.restoreAllMocks();
  });

  it('通常初期化でも connectedCallbackPromise が resolve されること', async () => {
    const router = document.createElement('wcs-router') as Router;
    router.innerHTML = `<template><wcs-route path="/"><h1>Home</h1></wcs-route></template>`;
    document.body.appendChild(router);
    await router.connectedCallbackPromise;
    expect(document.querySelector('wcs-outlet')?.querySelector('h1')?.textContent).toBe('Home');
    // SSR マーカーは付かない
    expect(document.querySelector('wcs-outlet')!.hasAttribute('data-wcs-ssr')).toBe(false);
    // a11y region は通常どおり生成される
    expect(router.a11yRegion).not.toBeNull();
  });
});

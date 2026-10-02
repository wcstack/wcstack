import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hideRoute } from '../src/hideRoute';
import { showRoute } from '../src/showRoute';
import { showRouteContent } from '../src/showRouteContent';
import { Route } from '../src/components/Route';
import { Router } from '../src/components/Router';
import { TRANSITION_RUNNER_KEY } from '../src/protocol/transitionRunner';
import type { IRouteMatchResult } from '../src/components/types';
import './setup';

/**
 * ルートの内容を範囲（placeholder 〜 終了マーカー）で持つこと（v4-remaining.ja.md §3 の
 * `@wcstack/router` の行）。ルートの内容に他のコードが描いたもの（state がページの走査で
 * 描いた行・枝と、それを描くアンカー）は、元のノード（childNodeArray）に入っていない。
 */

function mockMatch(route: Route, params: Record<string, string> = {}): IRouteMatchResult {
  return { params, typedParams: params, path: '', lastPath: '', routes: [route] };
}

/** placeholder を container に置いた、内容 `html` のルート */
function makeRoute(html: string, path = '/r'): { route: Route; container: HTMLElement } {
  const router = document.createElement('wcs-router') as Router;
  document.body.appendChild(router);
  const route = document.createElement('wcs-route') as Route;
  route.setAttribute('path', path);
  route.initialize(router, null);
  route.innerHTML = html;
  const container = document.createElement('div');
  container.appendChild(route.placeHolder);
  document.body.appendChild(container);
  return { route, container };
}

const markup = (el: Node): string => Array.from(el.childNodes, (n) =>
  n.nodeType === 8 ? `<!--${(n as Comment).data.replace(/^@@route:.*/, '@@route')}-->` : n.nodeType === 3 ? (n as Text).data : (n as Element).outerHTML).join('');

describe('ルートの範囲（placeholder 〜 終了マーカー）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('初めての表示は内容の後ろに終了マーカーを置き、他のコードが範囲の中に描いたもの（state の行・アンカー）も隠して同じ順で戻す', () => {
    const { route, container } = makeRoute(`<h2>list</h2><template id="t"></template>`);
    showRoute(route, mockMatch(route));
    expect(markup(container)).toBe(`<!--@@route--><h2>list</h2><template id="t"></template><!--@@wcs-route-end:/r-->`);
    // state がページの走査で描いたものに当たる: template をアンカーに置き換え、その前に行を描く
    const t = container.querySelector('#t')!;
    const anchor = document.createComment('wcs-for');
    t.replaceWith(anchor);
    anchor.before(Object.assign(document.createElement('p'), { textContent: 'a' }), Object.assign(document.createElement('p'), { textContent: 'b' }));
    const shown = markup(container);
    hideRoute(route);
    expect(markup(container)).toBe(`<!--@@route-->`);
    showRoute(route, mockMatch(route));
    // 置き換えられた template（親の無い元のノード）は戻さない
    expect(markup(container)).toBe(shown);
    expect(container.querySelector('template')).toBeNull();
  });

  it('範囲の外へ移された自分のノード（body へ移したダイアログ）は隠すときに外し、内容の中の元の位置に戻す', () => {
    const { route, container } = makeRoute(`<h2>a</h2><dialog>d</dialog><p>b</p>`);
    showRoute(route, mockMatch(route));
    const dialog = container.querySelector('dialog')!;
    document.body.appendChild(dialog);
    hideRoute(route);
    expect(document.body.contains(dialog)).toBe(false);
    showRoute(route, mockMatch(route));
    expect(markup(container)).toBe(`<!--@@route--><h2>a</h2><dialog>d</dialog><p>b</p><!--@@wcs-route-end:/r-->`);
  });

  it('範囲の中で別の要素の中へ移った自分のノードは、その要素ごと持つ（取り出さない）', () => {
    const { route, container } = makeRoute(`<section></section><p>x</p>`);
    showRoute(route, mockMatch(route));
    container.querySelector('section')!.appendChild(container.querySelector('p')!);
    hideRoute(route);
    showRoute(route, mockMatch(route));
    expect(markup(container)).toBe(`<!--@@route--><section><p>x</p></section><!--@@wcs-route-end:/r-->`);
  });

  it('範囲の外の兄弟（後から足したノード）は隠しても残る', () => {
    const { route, container } = makeRoute(`<p>x</p>`);
    showRoute(route, mockMatch(route));
    container.appendChild(Object.assign(document.createElement('aside'), { textContent: 'toast' }));
    hideRoute(route);
    expect(markup(container)).toBe(`<!--@@route--><aside>toast</aside>`);
  });

  it('終了マーカーが placeholder の後ろに無いとき（他のコードが動かした）は、元のノードだけを外して持つ（ほかのノードを巻き込まない）', () => {
    const { route, container } = makeRoute(`<p>x</p>`);
    showRoute(route, mockMatch(route));
    const other = document.createElement('i');
    container.appendChild(other);
    container.prepend(route.endMarker);
    hideRoute(route);
    expect(markup(container)).toBe(`<!--@@route--><i></i>`);
    showRoute(route, mockMatch(route));
    expect(markup(container)).toBe(`<!--@@route--><p>x</p><!--@@wcs-route-end:/r--><i></i>`);
  });

  it('表示中のルートをもう一度表示しても（パラメータの変化、親の再表示）、内容と描いたものは動かさない', () => {
    const { route, container } = makeRoute(`<p>x</p>`, '/r/:id');
    showRoute(route, mockMatch(route, { id: '1' }));
    container.querySelector('p')!.after(document.createElement('b'));
    const shown = markup(container);
    showRoute(route, mockMatch(route, { id: '2' }));
    expect(markup(container)).toBe(shown);
    expect(route.params).toEqual({ id: '2' });
  });

  it('placeholder が文書に無いときの表示は、持っている内容を失わない', () => {
    const { route, container } = makeRoute(`<p>x</p>`);
    showRoute(route, mockMatch(route));
    hideRoute(route);
    route.placeHolder.remove();
    showRoute(route, mockMatch(route));
    expect(route.held).not.toBeNull();
    container.appendChild(route.placeHolder);
    showRoute(route, mockMatch(route));
    expect(markup(container)).toBe(`<!--@@route--><p>x</p><!--@@wcs-route-end:/r-->`);
  });

  it('採用で終了マーカーを渡されなかったルートも、隠すと元のノードを外し、戻すと終了マーカーを置く', () => {
    const { route, container } = makeRoute(``);
    const p = document.createElement('p');
    container.appendChild(p);
    route.adoptChildNodes([p]);
    hideRoute(route);
    expect(markup(container)).toBe(`<!--@@route-->`);
    showRoute(route, mockMatch(route));
    expect(markup(container)).toBe(`<!--@@route--><p></p><!--@@wcs-route-end:/r-->`);
  });
});

describe('ルートの範囲と Router（入れ子・レイアウト・outlet・view transition）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    history.replaceState(null, '', '/');
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY];
    history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  async function boot(inner: string): Promise<Router> {
    document.body.innerHTML = `<wcs-router><template>${inner}</template></wcs-router>`;
    const router = document.querySelector('wcs-router') as Router;
    await router.connectedCallbackPromise;
    return router;
  }
  const outlet = () => document.querySelector('wcs-outlet')!;
  const ends = () => Array.from(outlet().querySelectorAll('*'), (e) => e).concat([outlet()])
    .flatMap((e) => Array.from(e.childNodes)).filter((n) => n.nodeType === 8 && (n as Comment).data.startsWith('@@wcs-route-end:')).map((n) => (n as Comment).data).sort();

  it('入れ子のルート: 親を隠すと子の範囲ごと持ち、子だけ・親子ともに戻す往復で内容が重ならない', async () => {
    const router = await boot(`
      <wcs-route path="/"><h1>home</h1></wcs-route>
      <wcs-route path="/a"><h2>A</h2><wcs-route path="b"><p class="b">B</p></wcs-route><wcs-route path="c"><p class="c">C</p></wcs-route><footer>f</footer></wcs-route>`);
    const text = () => outlet().textContent!.replace(/\s+/g, '');
    await router.navigate('/a/b');
    expect(text()).toBe('ABf');
    expect(ends()).toEqual(['@@wcs-route-end:/a', '@@wcs-route-end:/a/b']);
    await router.navigate('/');
    expect(text()).toBe('home');
    expect(ends()).toEqual(['@@wcs-route-end:/']);
    await router.navigate('/a/c');
    expect(text()).toBe('ACf');
    await router.navigate('/a/b');
    expect(text()).toBe('ABf');
    // 子の内容は子の placeholder の直後（親の範囲の中）
    expect(outlet().querySelector('p.b')!.previousSibling!.nodeType).toBe(8);
    expect(outlet().querySelectorAll('h2').length).toBe(1);
  });

  it('レイアウト（wcs-layout）の中の入れ子のルートも、隠して戻す往復で重ならない', async () => {
    const layout = document.createElement('template');
    layout.id = 'range-layout';
    layout.innerHTML = `<div class="frame"><slot></slot></div>`;
    const router = await boot(`
      <wcs-route path="/"><h1>home</h1></wcs-route>
      <wcs-route path="/l"><wcs-layout name="m" layout="range-layout"><wcs-route path="x"><p class="x">X</p></wcs-route></wcs-layout></wcs-route>`);
    document.body.appendChild(layout);
    await router.navigate('/l/x');
    await new Promise((r) => setTimeout(r, 0));
    expect(outlet().querySelectorAll('p.x').length).toBe(1);
    await router.navigate('/');
    expect(outlet().querySelector('p.x')).toBeNull();
    expect(outlet().querySelector('.frame')).toBeNull();
    await router.navigate('/l/x');
    await new Promise((r) => setTimeout(r, 0));
    expect(outlet().querySelectorAll('p.x').length).toBe(1);
    expect(outlet().querySelectorAll('.frame').length).toBe(1);
  });

  it('outlet: 終了マーカーはコメントなので :empty は変わらない（内容の無いルートでも空のまま）', async () => {
    const router = await boot(`<wcs-route path="/"></wcs-route><wcs-route path="/x"><p>x</p></wcs-route>`);
    expect(outlet().matches(':empty')).toBe(true);
    expect(ends()).toEqual(['@@wcs-route-end:/']);
    await router.navigate('/x');
    expect(outlet().matches(':empty')).toBe(false);
    await router.navigate('/');
    expect(outlet().matches(':empty')).toBe(true);
  });

  it('view transition: 範囲の移動は arbiter に渡した変更の中で起き、それまでは描いたものも残っている', async () => {
    const router = await boot(`<wcs-route path="/"><h1>home</h1></wcs-route><wcs-route path="/x"><p>x</p></wcs-route>`);
    const drawn = document.createElement('b');
    outlet().querySelector('h1')!.after(drawn);
    const deferred: Array<() => void> = [];
    (globalThis as unknown as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY] = {
      protocol: 'wcs-transition-runner', version: 1, naming: 'manual', namingLimit: 200, accepts: () => true,
      run: (mutate: () => void) => new Promise<void>((resolve) => deferred.push(() => { mutate(); resolve(); })),
    };
    const routes = router.routeChildNodes;
    const pending = showRouteContent(router, { routes: [routes[1]], params: {}, typedParams: {}, path: '/x', lastPath: '/' }, [routes[0]]);
    await new Promise((r) => setTimeout(r, 0));
    expect(drawn.isConnected).toBe(true);
    deferred[0]();
    await pending;
    expect(drawn.isConnected).toBe(false);
    expect(outlet().textContent).toBe('x');
  });
});

describe('ルートの範囲と SSR（開始・終了マーカー）', () => {
  function clearBody(): void {
    document.querySelectorAll('a').forEach((anchor) => anchor.remove());
    document.body.innerHTML = '';
  }

  async function serverRender(inner: string, urlPath: string, draw?: () => void): Promise<string> {
    document.documentElement.setAttribute('data-wcs-server', '');
    history.replaceState(null, '', urlPath);
    const router = document.createElement('wcs-router') as Router;
    router.setAttribute('enable-ssr', '');
    router.innerHTML = inner;
    document.body.appendChild(router);
    await router.connectedCallbackPromise;
    draw?.();
    const html = document.body.innerHTML;
    clearBody();
    document.documentElement.removeAttribute('data-wcs-server');
    return html;
  }

  const comments = (html: string): string[] => Array.from(html.matchAll(/<!--(@@wcs-route-[^>]*?)-->/g), (m) => m[1]);

  beforeEach(() => {
    clearBody();
    document.documentElement.removeAttribute('data-wcs-server');
    history.replaceState(null, '', '/');
    const base = document.createElement('base');
    base.setAttribute('href', '/');
    document.head.appendChild(base);
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-wcs-server');
    document.head.querySelectorAll('base').forEach((base) => base.remove());
    history.replaceState(null, '', '/');
  });

  const NESTED = `<template>
    <wcs-route path="/"><h1>home</h1></wcs-route>
    <wcs-route path="/a"><h2>A</h2><wcs-route path="b"><p class="b">B</p></wcs-route><footer>f</footer></wcs-route>
  </template>`;

  it('サーバーの出力: 開始マーカーは placeholder の直後、終了マーカーは範囲の終わりに 1 つずつ（子の範囲は親の範囲の中）。範囲の中に描かれたものも入る', async () => {
    const html = await serverRender(NESTED, '/a/b', () => {
      // state がサーバーで範囲の中に描いたものに当たる
      document.querySelector('p.b')!.after(Object.assign(document.createElement('i'), { textContent: 'row' }));
    });
    expect(comments(html)).toEqual([
      '@@wcs-route-ph:/', '@@wcs-route-ph:/a', '@@wcs-route-start:/a', '@@wcs-route-ph:/a/b', '@@wcs-route-start:/a/b', '@@wcs-route-end:/a/b', '@@wcs-route-end:/a',
    ]);
    expect(html).toMatch(/<!--@@wcs-route-start:\/a\/b--><p class="b">B<\/p><i>row<\/i><!--@@wcs-route-end:\/a\/b-->/);
  });

  it('採用: サーバーの終了マーカーをルートの範囲の終わりとして使い、退出と再入場で二重にならない（範囲の中に描かれたものも一緒に隠れる）', async () => {
    const html = await serverRender(NESTED, '/a/b');
    history.replaceState(null, '', '/a/b');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);
    const router = wrapper.querySelector('wcs-router') as Router;
    await router.connectedCallbackPromise;
    const outlet = document.querySelector('wcs-outlet')!;
    const marks = () => comments(outlet.innerHTML);
    // 開始マーカーは外れ、placeholder はクライアントのものに替わり、終了マーカーは残る
    expect(marks()).toEqual(['@@wcs-route-end:/a/b', '@@wcs-route-end:/a']);
    const drawn = Object.assign(document.createElement('i'), { textContent: 'row' });
    outlet.querySelector('p.b')!.after(drawn);
    await router.navigate('/');
    expect(drawn.isConnected).toBe(false);
    expect(outlet.textContent!.replace(/\s+/g, '')).toBe('home');
    await router.navigate('/a/b');
    expect(outlet.textContent!.replace(/\s+/g, '')).toBe('ABrowf');
    expect(marks().filter((m) => m.startsWith('@@wcs-route-end:'))).toEqual(['@@wcs-route-end:/a/b', '@@wcs-route-end:/a']);
  });
});

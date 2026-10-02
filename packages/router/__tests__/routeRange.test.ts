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
 * ルートの内容を範囲（placeholder 〜 終了マーカー）で持つこと（docs/binder-protocol-design.md §9-5、
 * docs/ssr-router-design.md §4）。ルートの内容に他のコードが描いたもの（state がページの走査で
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

/** 接続・切断を数える要素（再表示で connectedCallback がもう一度走るか） */
class RangeCount extends HTMLElement {
  log: string[] = [];
  route: { params: Record<string, string> } | null = null;
  connectedCallback(): void { this.log.push(this.route ? `connected:${this.route.params.id}` : 'connected'); }
  disconnectedCallback(): void { this.log.push('disconnected'); }
}
if (!customElements.get('range-count')) customElements.define('range-count', RangeCount);

/** 接続のたびに、そのとき見えているパラメータ（props.cid）を記録する要素 */
const probeLog: string[] = [];
class ParamProbe extends HTMLElement {
  props?: { cid?: string };
  connectedCallback(): void { probeLog.push(`c:${this.props?.cid}`); }
  disconnectedCallback(): void { probeLog.push('d'); }
}
if (!customElements.get('param-probe')) customElements.define('param-probe', ParamProbe);

/** disconnectedCallback で任意の書き換えをする要素 */
class RangeMutator extends HTMLElement {
  onDisconnect: (() => void) | null = null;
  disconnectedCallback(): void { this.onDisconnect?.(); }
}
if (!customElements.get('range-mutator')) customElements.define('range-mutator', RangeMutator);

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

  it('先頭の自分のノードが範囲の外へ移されていても、隠すと内容の先頭に戻す', () => {
    const { route, container } = makeRoute(`<dialog>d</dialog><p>x</p>`);
    showRoute(route, mockMatch(route));
    document.body.appendChild(container.querySelector('dialog')!);
    hideRoute(route);
    showRoute(route, mockMatch(route));
    expect(markup(container)).toBe(`<!--@@route--><dialog>d</dialog><p>x</p><!--@@wcs-route-end:/r-->`);
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

  it('表示中のルートをもう一度表示すると（パラメータの変化）、範囲を取り出して同じ順で戻し、カスタム要素は再接続する', () => {
    const { route, container } = makeRoute(`<h2>t</h2><range-count></range-count><footer>f</footer>`, '/r/:id');
    showRoute(route, mockMatch(route, { id: '1' }));
    // state が描いた行に当たる
    container.querySelector('range-count')!.after(document.createElement('b'));
    const shown = markup(container);
    const counter = container.querySelector('range-count') as RangeCount;
    counter.log.length = 0;
    counter.route = route;
    const observer = new MutationObserver(() => {});
    observer.observe(container, { childList: true });
    showRoute(route, mockMatch(route, { id: '2' }));
    // 順は変わらない（main は H2,P,FOOTER を P,FOOTER,H2 に並べ替えていた）
    expect(markup(container)).toBe(shown);
    expect(route.params).toEqual({ id: '2' });
    // 外して、同じ順で戻した（ブラウザでは connectedCallback がもう一度走り、新しいパラメータを読める）
    const records = observer.takeRecords();
    observer.disconnect();
    const names = (nodes: NodeList) => Array.from(nodes, (n) => n.nodeName);
    expect(records.flatMap((r) => names(r.removedNodes))).toEqual(['H2', 'RANGE-COUNT', 'B', 'FOOTER', '#comment']);
    expect(records.flatMap((r) => names(r.addedNodes))).toEqual(['H2', 'RANGE-COUNT', 'B', 'FOOTER', '#comment']);
    expect(counter.log).toEqual(['disconnected', 'connected:2']);
  });

  it('表示中のルートの再表示で、終了マーカーを他のコードが動かしていたら、元のノードと終了マーカーを placeholder の後ろへ戻す', () => {
    const { route, container } = makeRoute(`<h2>t</h2><p>x</p>`, '/r/:id');
    showRoute(route, mockMatch(route, { id: '1' }));
    container.prepend(route.endMarker);
    showRoute(route, mockMatch(route, { id: '2' }));
    expect(markup(container)).toBe(`<!--@@route--><h2>t</h2><p>x</p><!--@@wcs-route-end:/r/:id-->`);
  });

  // state がページの走査で描いたものに当たる: template をアンカーに置き換え、その前に行を描く
  function drawRows(container: HTMLElement): void {
    const anchor = document.createComment('wcs-for');
    container.querySelector('#t')!.replaceWith(anchor);
    anchor.before(Object.assign(document.createElement('b'), { textContent: 'row' }));
  }

  it('他のコードが終了マーカーを取り除いても、再表示と退場で、アンカーに置き換えられた template を戻さず、自分のノードの間に描かれたものも持ち運ぶ', () => {
    const { route, container } = makeRoute(`<h2>t</h2><template id="t"></template><p>x</p>`, '/r/:id');
    showRoute(route, mockMatch(route, { id: '1' }));
    drawRows(container);
    const shown = markup(container);
    expect(shown).toBe(`<!--@@route--><h2>t</h2><b>row</b><!--wcs-for--><p>x</p><!--@@wcs-route-end:/r/:id-->`);
    route.endMarker.remove();
    // パラメータの変化: 初めての表示として書かれたノードを入れ直さない
    showRoute(route, mockMatch(route, { id: '2' }));
    expect(markup(container)).toBe(shown);
    route.endMarker.remove();
    hideRoute(route);
    expect(markup(container)).toBe(`<!--@@route-->`);
    showRoute(route, mockMatch(route, { id: '3' }));
    expect(markup(container)).toBe(shown);
  });

  it('終了マーカーが取り除かれたとき、最後の自分のノードより後ろに描かれたものは範囲と見分けられず残るが、template は戻さない', () => {
    const { route, container } = makeRoute(`<h2>t</h2><template id="t"></template>`, '/r/:id');
    showRoute(route, mockMatch(route, { id: '1' }));
    drawRows(container);
    route.endMarker.remove();
    showRoute(route, mockMatch(route, { id: '2' }));
    expect(markup(container)).toBe(`<!--@@route--><h2>t</h2><!--@@wcs-route-end:/r/:id--><b>row</b><!--wcs-for-->`);
    expect(container.querySelector('template')).toBeNull();
  });

  it('表示中のルートの再表示は、範囲の外へ移された自分のノード（body のダイアログ）も元の位置へ戻す', () => {
    const { route, container } = makeRoute(`<h2>a</h2><dialog>d</dialog><p>b</p>`, '/r/:id');
    showRoute(route, mockMatch(route, { id: '1' }));
    document.body.appendChild(container.querySelector('dialog')!);
    showRoute(route, mockMatch(route, { id: '2' }));
    expect(markup(container)).toBe(`<!--@@route--><h2>a</h2><dialog>d</dialog><p>b</p><!--@@wcs-route-end:/r/:id-->`);
  });

  it('作者のコードが取り除いた直下のノード（閉じたお知らせ）は、次の入場で戻らない', () => {
    const { route, container } = makeRoute(`<aside class="notice">n</aside><p>x</p>`);
    showRoute(route, mockMatch(route));
    container.querySelector('aside')!.remove();
    hideRoute(route);
    showRoute(route, mockMatch(route));
    expect(markup(container)).toBe(`<!--@@route--><p>x</p><!--@@wcs-route-end:/r-->`);
  });

  it('二度隠しても（重なったナビゲーション）、持っている内容と描いたものを失わない', () => {
    const { route, container } = makeRoute(`<p>x</p>`);
    showRoute(route, mockMatch(route));
    container.querySelector('p')!.after(Object.assign(document.createElement('b'), { textContent: 'row' }));
    const shown = markup(container);
    hideRoute(route);
    hideRoute(route);
    expect(markup(container)).toBe(`<!--@@route-->`);
    showRoute(route, mockMatch(route));
    expect(markup(container)).toBe(shown);
  });

  it('外すときの disconnectedCallback が範囲を書き換えても（後ろのノードを外す・placeholder の後ろに足す・終了マーカーを外す）、止まらずに隠して戻せる', () => {
    const { route, container } = makeRoute(`<range-mutator></range-mutator><i class="partner"></i><p>x</p>`);
    showRoute(route, mockMatch(route));
    const mutator = container.querySelector('range-mutator') as RangeMutator;
    const partner = container.querySelector('i.partner')!;
    const added = document.createElement('aside');
    mutator.onDisconnect = () => {
      partner.remove(); // <wcs-link> が自分の anchor を外すのと同じ
      route.placeHolder.after(added);
      route.endMarker.remove();
    };
    hideRoute(route);
    mutator.onDisconnect = null;
    // 外されたノードは持ち直さない。足されたものは文書に残る
    expect(markup(container)).toBe(`<!--@@route--><aside></aside>`);
    expect(partner.parentNode).toBeNull();
    showRoute(route, mockMatch(route));
    expect(markup(container)).toBe(`<!--@@route--><range-mutator></range-mutator><p>x</p><!--@@wcs-route-end:/r--><aside></aside>`);
  });

  it('再表示の disconnectedCallback が後ろのノードを外しても、それは戻さない', () => {
    const { route, container } = makeRoute(`<range-mutator></range-mutator><i class="partner"></i><p>x</p>`, '/r/:id');
    showRoute(route, mockMatch(route, { id: '1' }));
    const mutator = container.querySelector('range-mutator') as RangeMutator;
    const partner = container.querySelector('i.partner')!;
    mutator.onDisconnect = () => { partner.remove(); };
    showRoute(route, mockMatch(route, { id: '2' }));
    mutator.onDisconnect = null;
    expect(markup(container)).toBe(`<!--@@route--><range-mutator></range-mutator><p>x</p><!--@@wcs-route-end:/r/:id-->`);
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

  describe('パラメータの変化と入れ子のルート: 子のカスタム要素は 1 回だけ再接続し、そのときに新しいパラメータを読む', () => {
    const shapes: Array<[string, string]> = [
      ['子が親の直下', `<wcs-route path="/p/:pid"><h2>P</h2><wcs-route path="c/:cid"><param-probe data-bind="props"></param-probe></wcs-route></wcs-route>`],
      ['子が親の要素の中', `<wcs-route path="/p/:pid"><div class="wrap"><h2>P</h2><wcs-route path="c/:cid"><param-probe data-bind="props"></param-probe></wcs-route></div></wcs-route>`],
    ];
    for (const [name, routes] of shapes) {
      it(name, async () => {
        const router = await boot(`<wcs-route path="/"><h1>home</h1></wcs-route>${routes}`);
        probeLog.length = 0; // the previous test's element left the document
        await router.navigate('/p/2/c/2');
        expect(probeLog).toEqual(['c:2']);
        probeLog.length = 0;
        // 親と子のパラメータがともに変わる
        await router.navigate('/p/3/c/3');
        expect(probeLog).toEqual(['d', 'c:3']);
        probeLog.length = 0;
        // 子のパラメータだけ
        await router.navigate('/p/3/c/4');
        expect(probeLog).toEqual(['d', 'c:4']);
        probeLog.length = 0;
        // 親のパラメータだけ（子は親と一緒に動く）
        await router.navigate('/p/5/c/4');
        expect(probeLog).toEqual(['d', 'c:4']);
        expect(outlet().querySelectorAll('param-probe').length).toBe(1);
        probeLog.length = 0;
      });
    }
  });

  it('終了マーカーが取り除かれ、自分のダイアログが隣のルートの placeholder より後ろへ移されていても、隠すときに隣のルートを巻き込まない', async () => {
    const router = await boot(`<wcs-route path="/"><h1>home</h1></wcs-route><wcs-route path="/a"><h2>A</h2><dialog>d</dialog></wcs-route><wcs-route path="/b"><h2>B</h2></wcs-route>`);
    await router.navigate('/a');
    const a = router.routeChildNodes[1];
    const b = router.routeChildNodes[2];
    a.endMarker.remove();
    outlet().appendChild(outlet().querySelector('dialog')!);
    await router.navigate('/b');
    expect(b.placeHolder.isConnected).toBe(true);
    expect(Array.from(outlet().querySelectorAll('h2, dialog'), (n) => n.textContent)).toEqual(['B']);
    await router.navigate('/a');
    expect(Array.from(outlet().querySelectorAll('h2, dialog'), (n) => n.textContent)).toEqual(['A', 'd']);
    await router.navigate('/b');
    expect(Array.from(outlet().querySelectorAll('h2, dialog'), (n) => n.textContent)).toEqual(['B']);
  });

  it('子の終了マーカーが取り除かれ、子のダイアログが親の範囲の後ろへ移されていても、子を隠すときに親の footer を持ち出さない', async () => {
    const router = await boot(`<wcs-route path="/"><h1>home</h1></wcs-route><wcs-route path="/p"><h2>P</h2><wcs-route path="c"><p class="c">C</p><dialog>d</dialog></wcs-route><wcs-route path="d"><p class="d">D</p></wcs-route><footer>f</footer></wcs-route>`);
    await router.navigate('/p/c');
    const c = router.routeChildNodes[1].routeChildNodes[0];
    c.endMarker.remove();
    outlet().appendChild(outlet().querySelector('dialog')!);
    await router.navigate('/p/d');
    const shown = () => Array.from(outlet().querySelectorAll('h2, p, dialog, footer'), (n) => n.textContent).join(',');
    expect(shown()).toBe('P,D,f');
    await router.navigate('/p/c');
    expect(shown()).toBe('P,C,d,f');
  });

  it('親の終了マーカーが取り除かれても、子の印は越えて親の範囲を持ち、子の内容（子の範囲に描かれたものを含む）も一緒に出入りする', async () => {
    const router = await boot(`<wcs-route path="/"><h1>home</h1></wcs-route><wcs-route path="/p"><h2>P</h2><wcs-route path="c"><p class="c">C</p></wcs-route><footer>f</footer></wcs-route>`);
    await router.navigate('/p/c');
    // state が子の範囲に描いたものに当たる
    outlet().querySelector('p.c')!.after(Object.assign(document.createElement('b'), { textContent: 'row' }));
    router.routeChildNodes[1].endMarker.remove();
    await router.navigate('/');
    expect(outlet().textContent!.replace(/s+/g, '')).toBe('home');
    await router.navigate('/p/c');
    expect(Array.from(outlet().querySelectorAll('h1, h2, p, b, footer'), (n) => n.textContent).join(',')).toBe('P,C,row,f');
  });

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

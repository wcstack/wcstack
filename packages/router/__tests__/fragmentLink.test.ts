import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Router } from '../src/components/Router';
import { createOutlet } from '../src/components/Outlet';
import * as applyRouteModule from '../src/applyRoute';
import {
  findIndicatedElement,
  focusFragmentTarget,
  fragmentHref,
  isCurrentPage,
  navigateEventHasSource,
  navigateToFragment,
  opensInThisWindow,
} from '../src/fragmentLink';
import './setup';

/**
 * 素のフラグメントへのリンク（`<a href="#main">` — スキップリンク）はページの中の移動
 * （docs/seam-apps.md、city-library）。`<base href="/">` の下では `#main` が `/#main` へ解決され、
 * `/search?q=a` で押すとホームのルートへ移っていた。
 */

let originalLocation: Location;
let assign: ReturnType<typeof vi.fn>;

/** 今のページを `href` にする（location は差し替え、assign は記録だけ） */
function at(href: string): void {
  const url = new URL(href);
  assign = vi.fn();
  (window as any).location = {
    href: url.href,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    origin: url.origin,
    assign,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  originalLocation = window.location;
  delete (window as any).location;
  at('http://localhost/search?q=a');
});

afterEach(() => {
  (window as any).location = originalLocation;
  delete (window as any).navigation;
  delete (globalThis as any).NavigateEvent;
  document.head.querySelectorAll('base').forEach((base) => base.remove());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function element(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild as HTMLElement;
}

describe('fragmentHref', () => {
  it('a / area の書いたままの href がフラグメントだけならその値（# 単独・前後の空白も）', () => {
    expect(fragmentHref(element('<a href="#main">skip</a>'))).toBe('#main');
    expect(fragmentHref(element('<a href="#">top</a>'))).toBe('#');
    expect(fragmentHref(element('<a href="  #main ">skip</a>'))).toBe('#main');
    const area = document.createElement('area');
    area.setAttribute('href', '#map-part');
    expect(fragmentHref(area)).toBe('#map-part');
  });

  it('別のページへのリンク・href の無いリンク・リンクでない要素は null', () => {
    expect(fragmentHref(element('<a href="/faq#x">faq</a>'))).toBeNull();
    expect(fragmentHref(element('<a href="?q=b#x">q</a>'))).toBeNull();
    expect(fragmentHref(element('<a href="faq#x">faq</a>'))).toBeNull();
    expect(fragmentHref(element('<a name="x">anchor</a>'))).toBeNull();
    expect(fragmentHref(element('<button href="#x">b</button>'))).toBeNull();
    expect(fragmentHref(null)).toBeNull();
    expect(fragmentHref(undefined)).toBeNull();
  });
});

describe('findIndicatedElement', () => {
  it('id の要素、無ければ name を持つ <a>（a 以外の name は数えない）', () => {
    element('<input name="field">');
    const named = element('<a name="old-anchor">old</a>');
    const main = element('<main id="main"></main>');
    expect(findIndicatedElement('main')).toBe(main);
    expect(findIndicatedElement('old-anchor')).toBe(named);
    expect(findIndicatedElement('field')).toBeNull();
    expect(findIndicatedElement('missing')).toBeNull();
    expect(findIndicatedElement('')).toBeNull();
  });

  it('書いたままの値で見つからなければパーセントデコードして探す。壊れたエンコードは null', () => {
    const target = element('<section id="本の一覧"></section>');
    expect(findIndicatedElement(encodeURIComponent('本の一覧'))).toBe(target);
    const literal = element('<section id="a%20b"></section>');
    expect(findIndicatedElement('a%20b')).toBe(literal);
    expect(findIndicatedElement('%E0%A4%A')).toBeNull();
  });
});

describe('focusFragmentTarget', () => {
  it('フォーカスできない要素には tabindex="-1" を足してフォーカスする', () => {
    const main = element('<main id="main"></main>');
    const focus = vi.spyOn(main, 'focus');
    focusFragmentTarget('main');
    expect(main.getAttribute('tabindex')).toBe('-1');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(main);
  });

  it('自分でフォーカスを受ける要素・tabindex のある要素には tabindex を足さない', () => {
    const input = element('<input id="q">');
    focusFragmentTarget('q');
    expect(input.hasAttribute('tabindex')).toBe(false);
    expect(document.activeElement).toBe(input);
    const card = element('<div id="card" tabindex="0"></div>');
    focusFragmentTarget('card');
    expect(card.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(card);
  });

  it('指す要素が無い（# 単独・#top）ならフォーカスを動かさない', () => {
    const button = element('<button>here</button>');
    button.focus();
    focusFragmentTarget('');
    focusFragmentTarget('top');
    expect(document.activeElement).toBe(button);
  });
});

describe('isCurrentPage', () => {
  it('フラグメントを除いて今の URL と同じなら true', () => {
    at('http://localhost/search?q=a#old');
    expect(isCurrentPage('http://localhost/search?q=a#main')).toBe(true);
    expect(isCurrentPage('http://localhost/search?q=a')).toBe(true);
    expect(isCurrentPage('http://localhost/search?q=a#')).toBe(true);
    expect(isCurrentPage('http://localhost/#main')).toBe(false);
    expect(isCurrentPage('http://localhost/search?q=b#main')).toBe(false);
    expect(isCurrentPage('http://other.example/search?q=a#main')).toBe(false);
  });
});

describe('opensInThisWindow', () => {
  it('target も <base target> も無い、または _self ならこのウィンドウ', () => {
    expect(opensInThisWindow(element('<a href="#x">x</a>'))).toBe(true);
    expect(opensInThisWindow(element('<a href="#x" target="_SELF">x</a>'))).toBe(true);
    expect(opensInThisWindow(element('<a href="#x" target="_blank">x</a>'))).toBe(false);
  });

  it('<base target> が別のウィンドウなら、リンクの target が勝つ', () => {
    const base = document.createElement('base');
    base.setAttribute('target', '_blank');
    document.head.appendChild(base);
    expect(opensInThisWindow(element('<a href="#x">x</a>'))).toBe(false);
    expect(opensInThisWindow(element('<a href="#x" target="_self">x</a>'))).toBe(true);
  });
});

describe('navigateEventHasSource', () => {
  it('NavigateEvent が sourceElement を持つときだけ true', () => {
    expect(navigateEventHasSource()).toBe(false);
    (globalThis as any).NavigateEvent = class {};
    expect(navigateEventHasSource()).toBe(false);
    (globalThis as any).NavigateEvent = class { get sourceElement() { return null; } };
    expect(navigateEventHasSource()).toBe(true);
  });
});

describe('navigateToFragment', () => {
  it('今のパスとクエリ＋そのハッシュへフラグメントのナビゲーションをして、指す要素へフォーカスする', () => {
    const main = element('<main id="main"></main>');
    navigateToFragment('#main');
    expect(assign).toHaveBeenCalledWith('http://localhost/search?q=a#main');
    expect(document.activeElement).toBe(main);
  });

  it('今のハッシュは置き換える。# 単独は空のフラグメント（先頭へ）で、フォーカスは動かさない', () => {
    at('http://localhost/search?q=a#old');
    const button = element('<button>here</button>');
    button.focus();
    navigateToFragment('#');
    expect(assign).toHaveBeenCalledWith('http://localhost/search?q=a#');
    expect(document.activeElement).toBe(button);
  });
});

/** navigate イベント（Navigation API）の mock */
function navEvent(overrides: Record<string, unknown> = {}) {
  return {
    canIntercept: true,
    cancelable: true,
    hashChange: false,
    downloadRequest: null,
    navigationType: 'push',
    destination: { url: 'http://localhost/#main' },
    sourceElement: null as Element | null,
    preventDefault: vi.fn(),
    intercept: vi.fn(),
    ...overrides,
  };
}

function routerAt(basename = ''): Router {
  const router = document.createElement('wcs-router') as Router;
  (router as any)._basename = basename;
  (router as any)._outlet = createOutlet();
  (router as any)._outlet.routesNode = router;
  (router as any)._path = '/search';
  (router as any)._hasCommitted = true;
  return router;
}

describe('Router: navigate イベントの経路（Navigation API）', () => {
  it('<base> が別のページへ解決したスキップリンク: 取り消して今のページのフラグメントへ移り、ルートは動かない', () => {
    const router = routerAt();
    const applySpy = vi.spyOn(applyRouteModule, 'applyRoute').mockResolvedValue(true);
    const main = element('<main id="main"></main>');
    const skip = element('<a href="#main">skip</a>');
    const event = navEvent({ sourceElement: skip });

    (router as any)._onNavigateFunc(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.intercept).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('http://localhost/search?q=a#main');
    expect(applySpy).not.toHaveBeenCalled();
    expect(main.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(main);
  });

  it('ブラウザが今のページのフラグメントへ移すもの（hashChange）はそのまま通し、フォーカスだけ移す', () => {
    const router = routerAt();
    const main = element('<main id="main"></main>');
    const skip = element('<a href="#main">skip</a>');
    const event = navEvent({
      sourceElement: skip,
      hashChange: true,
      destination: { url: 'http://localhost/search?q=a#main' },
    });

    (router as any)._onNavigateFunc(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.intercept).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(main);
  });

  it('今の URL と同じフラグメントへもう一度（hashChange は false で来る）: そのまま通し、フォーカスを移す', () => {
    at('http://localhost/search?q=a#main');
    const router = routerAt();
    const main = element('<main id="main"></main>');
    const event = navEvent({
      sourceElement: element('<a href="#main">skip</a>'),
      navigationType: 'replace',
      destination: { url: 'http://localhost/search?q=a#main' },
    });

    (router as any)._onNavigateFunc(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.intercept).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(main);
  });

  it('リンクの無い、今の URL のフラグメントへのナビゲーション（移し直した 2 度目）も受けない — 受けるとブラウザがスクロールしない', () => {
    at('http://localhost/search?q=a#main');
    const router = routerAt();
    const event = navEvent({ navigationType: 'replace', destination: { url: 'http://localhost/search?q=a#main' } });

    (router as any)._onNavigateFunc(event);

    expect(event.intercept).not.toHaveBeenCalled();
  });

  it('フラグメントの無い今の URL へのナビゲーションは従来どおり受ける（same-match）', () => {
    const router = routerAt();
    const event = navEvent({ navigationType: 'replace', destination: { url: 'http://localhost/search?q=a' } });

    (router as any)._onNavigateFunc(event);

    expect(event.intercept).toHaveBeenCalled();
  });

  it('leaveConfirm があっても聞かない（ページを離れない）', () => {
    const router = routerAt();
    router.setAttribute('leave-confirm', 'Discard?');
    const confirmSpy = vi.fn(() => false);
    const originalConfirm = (window as any).confirm;
    (window as any).confirm = confirmSpy;
    try {
      element('<main id="main"></main>');
      const event = navEvent({ sourceElement: element('<a href="#main">skip</a>') });

      (router as any)._onNavigateFunc(event);

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(assign).toHaveBeenCalledWith('http://localhost/search?q=a#main');
    } finally {
      (window as any).confirm = originalConfirm;
    }
  });

  it('今のページを受け持たない router（basename の外）は何もしない — 受け持つ router が動く', () => {
    const router = routerAt('/admin');
    const event = navEvent({ sourceElement: element('<a href="#main">skip</a>') });

    (router as any)._onNavigateFunc(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.intercept).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('別のページのフラグメントへのリンク（/faq#x）はルートの遷移のまま', () => {
    const router = routerAt();
    const event = navEvent({
      sourceElement: element('<a href="/faq#x">faq</a>'),
      destination: { url: 'http://localhost/faq#x' },
    });

    (router as any)._onNavigateFunc(event);

    expect(event.intercept).toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('別の文書のリンク・リンクでない sourceElement（フォームの送信ボタン）は数えない', () => {
    const router = routerAt();
    const foreign = document.implementation.createHTMLDocument('other').createElement('a');
    foreign.setAttribute('href', '#main');
    const fromForeign = navEvent({ sourceElement: foreign, destination: { url: 'http://localhost/' } });
    (router as any)._onNavigateFunc(fromForeign);
    expect(fromForeign.intercept).toHaveBeenCalled();

    const button = element('<button>send</button>');
    const fromButton = navEvent({ sourceElement: button, destination: { url: 'http://localhost/results' } });
    (router as any)._onNavigateFunc(fromButton);
    expect(fromButton.intercept).toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('リンクの無いフラグメントのナビゲーション（location.hash・戻る / 進む）はブラウザのまま', () => {
    const router = routerAt();
    const event = navEvent({
      hashChange: true,
      navigationType: 'traverse',
      destination: { url: 'http://localhost/search?q=a' },
    });

    (router as any)._onNavigateFunc(event);

    expect(event.intercept).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('download のリンク・ページが取り消したナビゲーションには触らない', () => {
    const router = routerAt();
    const skip = element('<a href="#main" download>skip</a>');
    const download = navEvent({ sourceElement: skip, downloadRequest: '' });
    (router as any)._onNavigateFunc(download);
    const prevented = navEvent({ sourceElement: skip, defaultPrevented: true });
    (router as any)._onNavigateFunc(prevented);

    expect(download.preventDefault).not.toHaveBeenCalled();
    expect(prevented.preventDefault).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});

/** click イベントの mock（合成パスはリンクから window まで） */
function clickOn(target: Element, overrides: Record<string, unknown> = {}) {
  const path: EventTarget[] = [];
  for (let node: Node | null = target; node; node = node.parentNode) path.push(node);
  path.push(window);
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    composedPath: () => path,
    preventDefault: vi.fn(),
    ...overrides,
  };
}

describe('Router: click の経路（Navigation API が無い・sourceElement が無い）', () => {
  it('スキップリンクのクリック: 取り消して今のページのフラグメントへ移る（リンクの中の要素を押しても）', () => {
    const router = routerAt();
    const main = element('<main id="main"></main>');
    const skip = element('<a href="#main"><span>skip</span></a>');
    const event = clickOn(skip.querySelector('span')!);

    (router as any)._onClick(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('http://localhost/search?q=a#main');
    expect(document.activeElement).toBe(main);
  });

  it('open な shadow root の中のリンクも拾う', () => {
    const router = routerAt();
    const host = element('<div></div>');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<a href="#main">skip</a>';
    const link = root.querySelector('a')!;
    const event = clickOn(link, { composedPath: () => [link, root, host, document.body, document, window] });

    (router as any)._onClick(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('http://localhost/search?q=a#main');
  });

  it('修飾キー・中ボタン・取り消し済み・target・download・別のページへのリンクはブラウザに任せる', () => {
    const router = routerAt();
    const skip = element('<a href="#main">skip</a>');
    const cases = [
      clickOn(skip, { ctrlKey: true }),
      clickOn(skip, { metaKey: true }),
      clickOn(skip, { shiftKey: true }),
      clickOn(skip, { altKey: true }),
      clickOn(skip, { button: 1 }),
      clickOn(skip, { defaultPrevented: true }),
      clickOn(element('<a href="#main" target="_blank">new tab</a>')),
      clickOn(element('<a href="#main" download>file</a>')),
      clickOn(element('<a href="/faq#x">faq</a>')),
      clickOn(element('<a href="?q=b#x">other query</a>')),
      clickOn(element('<p>not a link</p>')),
    ];
    for (const event of cases) {
      (router as any)._onClick(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(assign).not.toHaveBeenCalled();
  });

  it('今のページを受け持たない router は何もしない', () => {
    const router = routerAt('/admin');
    const event = clickOn(element('<a href="#main">skip</a>'));

    (router as any)._onClick(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('Router: click リスナーの登録', () => {
  it('Navigation API が無ければ登録し、切断で外す', async () => {
    const router = document.createElement('wcs-router') as Router;
    (router as any)._initialized = true;
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    await router.connectedCallback();
    expect(addSpy).toHaveBeenCalledWith('click', (router as any)._onClick);
    // 二度目の接続で重ねない
    addSpy.mockClear();
    await router.connectedCallback();
    expect(addSpy).not.toHaveBeenCalledWith('click', expect.anything());

    router.disconnectedCallback();
    expect(removeSpy).toHaveBeenCalledWith('click', (router as any)._onClick);
    expect((router as any)._listeningClick).toBe(false);
  });

  it('NavigateEvent に sourceElement が無ければ Navigation API があっても登録し、あれば登録しない', async () => {
    (window as any).navigation = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const addSpy = vi.spyOn(window, 'addEventListener');

    const withoutSource = document.createElement('wcs-router') as Router;
    (withoutSource as any)._initialized = true;
    await withoutSource.connectedCallback();
    expect(addSpy).toHaveBeenCalledWith('click', (withoutSource as any)._onClick);
    withoutSource.disconnectedCallback();

    (globalThis as any).NavigateEvent = class { get sourceElement() { return null; } };
    addSpy.mockClear();
    const withSource = document.createElement('wcs-router') as Router;
    (withSource as any)._initialized = true;
    await withSource.connectedCallback();
    expect(addSpy).not.toHaveBeenCalledWith('click', expect.anything());
    withSource.disconnectedCallback();
  });
});

describe('Router: ページの上で（<base href="/"> の下、クリックから）', () => {
  it('/search?q=a でスキップリンクを押すと、ルートは /search のまま URL が #main になり、<main> にフォーカスが移る', async () => {
    (window as any).location = originalLocation;
    history.replaceState(null, '', '/search?q=a');
    const base = document.createElement('base');
    base.setAttribute('href', '/');
    document.head.appendChild(base);
    document.body.innerHTML = `
      <a id="skip" href="#main">Skip to content</a>
      <wcs-router>
        <template>
          <wcs-route path="/"><main id="main"><h1>Home</h1></main></wcs-route>
          <wcs-route path="/search"><main id="main"><h1>Search</h1></main></wcs-route>
        </template>
      </wcs-router>
      <wcs-outlet></wcs-outlet>
    `;
    const router = document.querySelector('wcs-router') as Router;
    await router.connectedCallbackPromise;
    expect(document.querySelector('wcs-outlet h1')?.textContent).toBe('Search');

    const applySpy = vi.spyOn(applyRouteModule, 'applyRoute');
    // ブラウザのフラグメントのナビゲーションの代わり（happy-dom の location.assign は非同期に読み込み直す）
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation((url) => {
      history.pushState(null, '', String(url));
    });
    // ブラウザなら <base> で /#main へ解決される（happy-dom はリンクの解決に <base> を使わないので、ここは押すことだけ）
    const skip = document.getElementById('skip')!;
    skip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

    expect(assignSpy).toHaveBeenCalledWith(new URL('/search?q=a#main', window.location.href).href);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/search?q=a#main');
    expect(applySpy).not.toHaveBeenCalled();
    expect(document.querySelector('wcs-outlet h1')?.textContent).toBe('Search');
    const main = document.querySelector('wcs-outlet main') as HTMLElement;
    expect(document.activeElement).toBe(main);
    expect(main.getAttribute('tabindex')).toBe('-1');
    router.remove();
  });
});

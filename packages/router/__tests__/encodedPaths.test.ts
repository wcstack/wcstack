/**
 * encodedPaths.test.ts — ルートの静的セグメントは書かれた文字そのもの、URL のセグメントはパーセントデコードして比べる（#694）。
 *
 * 4.24.1 まで: 静的セグメントをそのまま正規表現にしていた（path="/v1.0" が /v1x0 に一致し、path="/c++" は
 * SyntaxError で router ごと止まった）。URL のパスはエンコードされたまま比べていた（path="/café" はどの URL にも
 * 一致せず、/users/€ の id は "%E2%82%AC"、to="/users/€" のリンクはそのページでも現在のページにならなかった）。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { bootstrapRouter } from '../src/exports';
import { encodePathname, decodeSegment, normalizePathname, normalizeBasename } from '../src/normalizePathname';
import { matchRoutes } from '../src/matchRoutes';
import type { Router } from '../src/components/Router';
import type { Route } from '../src/components/Route';
import type { Link } from '../src/components/Link';

beforeAll(() => {
  bootstrapRouter();
  // （<base href> が無いと、router は今の URL のパスを basename に取る）
  document.head.innerHTML = '<base href="/">';
  history.replaceState(null, '', '/');
});

afterEach(() => {
  document.querySelectorAll('a').forEach((anchor) => anchor.remove());
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

/** routes の path を持つ router（初期化だけ。画面には出さない）。 */
function routerOf(...paths: string[]): Router {
  const router = document.createElement('wcs-router') as Router;
  document.body.appendChild(router);
  for (const path of paths) {
    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', path);
    route.setAttribute('name', path);
    route.initialize(router, null);
  }
  return router;
}
const matched = (router: Router, url: string) => matchRoutes(router, normalizePathname(url))?.routes.at(-1)?.name ?? null;

describe('encodePathname: アプリが書いたパスを location.pathname の形にする', () => {
  it('URL のパスにそのまま置ける文字だけなら、そのまま返す', () => {
    expect(encodePathname('/users/123/edit')).toBe('/users/123/edit');
    expect(encodePathname("/a-b_c.d~e!$&'()*+,;=:@")).toBe("/a-b_c.d~e!$&'()*+,;=:@");
    expect(encodePathname('/[x]/a|b/a^b')).toBe('/[x]/a|b/a^b');
  });

  it('ASCII でない文字と空白をパーセントエンコードする。すでにあるエスケープと、単独の % は触らない', () => {
    expect(encodePathname('/café')).toBe('/caf%C3%A9');
    expect(encodePathname('/users/€')).toBe('/users/%E2%82%AC');
    expect(encodePathname('/a b')).toBe('/a%20b');
    expect(encodePathname('/caf%C3%A9/é')).toBe('/caf%C3%A9/%C3%A9');
    expect(encodePathname('/100%/é')).toBe('/100%/%C3%A9');
  });

  it('? と # はパスの文字として扱う（クエリとフラグメントは呼び出し側が先に分けている）', () => {
    expect(encodePathname('/what?')).toBe('/what%3F');
    expect(encodePathname('/a#b')).toBe('/a%23b');
  });

  it('"." と ".." のセグメントは、ブラウザと同じに解決する', () => {
    expect(encodePathname('/a/./b')).toBe('/a/b');
    expect(encodePathname('/a/../b')).toBe('/b');
    expect(encodePathname('/a/..')).toBe('/');
    // セグメントの一部のドットは、そのまま
    expect(encodePathname('/v1.0/..a/b..')).toBe('/v1.0/..a/b..');
  });

  it('バックスラッシュのあるパスは触らない（パーサはそれをスラッシュに読み替える）', () => {
    expect(encodePathname('/a\\b/é')).toBe('/a\\b/é');
  });

  it('normalizePathname と normalizeBasename はこの形で返す', () => {
    expect(normalizePathname('/users/€/')).toBe('/users/%E2%82%AC');
    expect(normalizePathname('users//a b')).toBe('/users/a%20b');
    expect(normalizeBasename('/アプリ/')).toBe('/%E3%82%A2%E3%83%97%E3%83%AA');
  });
});

describe('decodeSegment: URL のセグメントを、それが表す文字列にする', () => {
  it('エスケープの無いセグメントはそのまま', () => {
    expect(decodeSegment('users')).toBe('users');
  });

  it('エスケープをデコードする。エンコードされたスラッシュと % も', () => {
    expect(decodeSegment('caf%C3%A9')).toBe('café');
    expect(decodeSegment('a%2Fb')).toBe('a/b');
    expect(decodeSegment('100%25')).toBe('100%');
  });

  it('UTF-8 として正しくないエスケープのあるセグメントは、そのまま返す', () => {
    expect(decodeSegment('%E0%A4%A')).toBe('%E0%A4%A');
    expect(decodeSegment('100%')).toBe('100%');
  });
});

describe('静的セグメントは書かれた文字そのもの', () => {
  it('path="/v1.0" は /v1.0 に一致し、/v1x0 には一致しない', () => {
    const router = routerOf('/v1.0');
    expect(matched(router, '/v1.0')).toBe('/v1.0');
    expect(matched(router, '/v1x0')).toBeNull();
    expect(matched(router, '/v100')).toBeNull();
  });

  it('正規表現の文字を持つ path でも例外にならず、その文字に一致する', () => {
    // （URL は location.pathname の形: ? は %3F。[ ] | ^ はそのまま）
    const cases: [string, string, string][] = [
      ['/c++', '/c++', '/c'],
      ['/a(b)', '/a(b)', '/ab'],
      ['/[x]', '/[x]', '/x'],
      ['/a|b', '/a|b', '/a'],
      ['/what?', '/what%3F', '/wha'],
      ['/a*b', '/a*b', '/aaab'],
      ['/$price', '/$price', '/price'],
      ['/a^b', '/a^b', '/ab'],
      ['/a{2}', '/a%7B2%7D', '/aa'],
      ['/back\\d', '/back%5Cd', '/back1'],
    ];
    for (const [path, url, other] of cases) {
      const router = routerOf(path);
      expect(matched(router, url), `${path} ← ${url}`).toBe(path);
      expect(matched(router, other), `${path} ← ${other}`).toBeNull();
      router.remove();
    }
  });
});

describe('URL のセグメントはデコードして比べる', () => {
  it('path="/café" は /caf%C3%A9 に一致する。エンコードして書いた path="/caf%C3%A9" も同じ', () => {
    expect(matched(routerOf('/café'), '/caf%C3%A9')).toBe('/café');
    expect(matched(routerOf('/caf%C3%A9'), '/caf%C3%A9')).toBe('/caf%C3%A9');
    // アプリが書いたままの文字列を渡しても同じ（normalizePathname が URL の形にする）
    expect(matched(routerOf('/café'), '/café')).toBe('/café');
  });

  it('パラメータの値はデコードされた文字列。path は URL の形のまま', () => {
    const router = routerOf('/users/:id');
    const result = matchRoutes(router, '/users/%E2%82%AC')!;
    expect(result.params).toEqual({ id: '€' });
    expect(result.typedParams).toEqual({ id: '€' });
    expect(result.path).toBe('/users/%E2%82%AC');
    expect(matchRoutes(router, '/users/a%20b')!.params).toEqual({ id: 'a b' });
    expect(matchRoutes(router, '/users/100%25')!.params).toEqual({ id: '100%' });
  });

  it('エンコードされたスラッシュはセグメントを分けず、値の中の "/" になる', () => {
    const router = routerOf('/users/:id');
    expect(matchRoutes(router, '/users/a%2Fb')!.params).toEqual({ id: 'a/b' });
    // 本物のスラッシュはセグメントを分ける
    expect(matchRoutes(router, '/users/a/b')).toBeNull();
  });

  it('UTF-8 として正しくないエスケープは、そのままの文字列で渡す', () => {
    expect(matchRoutes(routerOf('/users/:id'), '/users/%E0%A4%A')!.params).toEqual({ id: '%E0%A4%A' });
  });

  it('型付きのパラメータは、デコードした値で判定する', () => {
    const router = routerOf('/n/:n(int)');
    const result = matchRoutes(router, '/n/%34%32')!;
    expect(result.params).toEqual({ n: '42' });
    expect(result.typedParams).toEqual({ n: 42 });
    expect(matchRoutes(router, '/n/4%2F2')).toBeNull();
  });

  it('catch-all の残りも、セグメントごとにデコードして "/" でつなぐ', () => {
    const result = matchRoutes(routerOf('/files/*'), '/files/a%20b/%C3%A7.txt')!;
    expect(result.params).toEqual({ '*': 'a b/ç.txt' });
    expect(result.typedParams).toEqual({ '*': 'a b/ç.txt' });
  });

  it('デコードすると改行になる値も受ける（パラメータも catch-all も）', () => {
    expect(matchRoutes(routerOf('/users/:id'), '/users/a%0Ab')!.params).toEqual({ id: 'a\nb' });
    expect(matchRoutes(routerOf('/files/*'), '/files/a%0Ab/c')!.params).toEqual({ '*': 'a\nb/c' });
  });
});

describe('router とリンクを通して', () => {
  const page = `
    <wcs-router>
      <template>
        <wcs-route path="/" name="home"><p>home</p></wcs-route>
        <wcs-route path="/v1.0" name="v1"><p>v1.0</p></wcs-route>
        <wcs-route path="/café" name="cafe"><p>café</p></wcs-route>
        <wcs-route path="/c++" name="cpp"><p>c++</p></wcs-route>
        <wcs-route path="/users/:id" name="user"><p>user</p></wcs-route>
        <wcs-route fallback name="404"><p>not found</p></wcs-route>
      </template>
    </wcs-router>
    <wcs-outlet></wcs-outlet>
    <wcs-link id="l-cafe" to="/café">café</wcs-link>
    <wcs-link id="l-euro" to="/users/€">euro</wcs-link>
    <wcs-link id="l-space" to="/users/a b">space</wcs-link>
  `;
  async function open(url: string): Promise<Router> {
    history.replaceState(null, '', url);
    document.body.innerHTML = page;
    const router = document.querySelector('wcs-router') as Router;
    await router.connectedCallbackPromise;
    return router;
  }
  /** 現在のページの印（aria-current）が付いているリンクの id。 */
  const current = () => [...document.querySelectorAll<Link>('wcs-link')]
    .filter((link) => link.anchorElement?.hasAttribute('aria-current'))
    .map((link) => link.id);

  it('読み込み: 報告の 3 つの URL と /c++', async () => {
    let router = await open('/v1x0');
    expect(router.routeName).toBe('404');
    router = await open('/café');
    expect(router.routeName).toBe('cafe');
    expect(router.path).toBe('/caf%C3%A9');
    router = await open('/users/€');
    expect(router.routeName).toBe('user');
    expect(router.params).toEqual({ id: '€' });
    expect(router.path).toBe('/users/%E2%82%AC');
    router = await open('/c++');
    expect(router.routeName).toBe('cpp');
  });

  it('navigate() に書いたままのパスを渡しても、path は読み込みのときと同じ URL の形になる', async () => {
    const router = await open('/');
    await router.navigate('/users/€');
    expect(router.routeName).toBe('user');
    expect(router.params).toEqual({ id: '€' });
    expect(router.path).toBe('/users/%E2%82%AC');
    expect(location.pathname).toBe('/users/%E2%82%AC');
    // 同じ行き先をエンコードして渡しても同じ
    await router.navigate('/');
    await router.navigate('/users/%E2%82%AC');
    expect(router.params).toEqual({ id: '€' });
    expect(router.path).toBe('/users/%E2%82%AC');
    await router.navigate('/café');
    expect(router.routeName).toBe('cafe');
  });

  it('to に ASCII でない文字や空白のあるリンクは、そのページで現在のページになる', async () => {
    const router = await open('/users/€');
    expect(current()).toEqual(['l-euro']);
    expect((document.querySelector('#l-euro') as Link).anchorElement!.getAttribute('aria-current')).toBe('page');
    await router.navigate('/users/a b');
    expect(router.params).toEqual({ id: 'a b' });
    expect(current()).toEqual(['l-space']);
    await router.navigate('/café');
    expect(current()).toEqual(['l-cafe']);
  });
});

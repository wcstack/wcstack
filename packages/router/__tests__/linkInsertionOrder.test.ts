import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { bootstrapRouter } from '../src/exports';
import type { Router } from '../src/components/Router';

/**
 * タグを定義した後で流し込んだページの `<wcs-link>`（@wcstack/testing の mount() がそうする）。
 *
 * happy-dom の `innerHTML` は開始タグの時点で connectedCallback を呼ぶ（フラグメントを一度に append しても節ごと）。
 * リンクをルーターより前に書くと、接続の時点でルーターがまだ文書に無く、リンクは「wcs-link is not connected to
 * a router.」を投げて mount() が失敗した。後ろに書くと、ルーターはまだ初期化の前（子の <template> を待つ）で
 * basename が空のまま href を作り、`/app/next` が `/next` になった（Advent Calendar の制作の記録、
 * docs/v4-direction-2026-10.md §5.27）。
 */
beforeAll(() => {
  bootstrapRouter();
  history.replaceState(null, '', '/app/');
  const base = document.createElement('base');
  base.setAttribute('href', '/app/');
  document.head.appendChild(base);
});

afterAll(() => {
  document.head.querySelector('base')?.remove();
  history.replaceState(null, '', '/');
});

afterEach(() => {
  // (the anchors first: a link removes its own anchor on disconnect, which trips happy-dom's innerHTML setter)
  document.querySelectorAll('a').forEach((anchor) => anchor.remove());
  document.body.innerHTML = '';
  history.replaceState(null, '', '/app/');
});

const NAV = `<nav><wcs-link to="/">最初</wcs-link><wcs-link to="/next">次</wcs-link></nav>`;
const ROUTER = `
  <wcs-router>
    <template>
      <wcs-route path="/"><h2>最初の画面</h2></wcs-route>
      <wcs-route path="/next"><h2>次の画面</h2></wcs-route>
    </template>
  </wcs-router>
  <wcs-outlet></wcs-outlet>`;

function anchors(): { text: string | null; href: string | null; current: string | null }[] {
  return [...document.querySelectorAll('nav wcs-link + a')].map((a) => ({
    text: a.textContent,
    href: a.getAttribute('href'),
    current: a.getAttribute('aria-current'),
  }));
}

describe('流し込んだページの <wcs-link>（ルーターとの順）', () => {
  it('リンクがルーターより前でも、初期化の後のルーターの basename で組み立てる', async () => {
    document.body.innerHTML = NAV + ROUTER;
    await (document.querySelector('wcs-router') as Router).connectedCallbackPromise;
    expect(anchors()).toEqual([
      { text: '最初', href: '/app/', current: 'page' },
      { text: '次', href: '/app/next', current: null },
    ]);
  });

  it('リンクがルーターより後ろでも、href はルーターの初期化の後に basename を付けて引き直す', async () => {
    document.body.innerHTML = ROUTER + NAV;
    await (document.querySelector('wcs-router') as Router).connectedCallbackPromise;
    expect(anchors().map(({ href, current }) => ({ href, current }))).toEqual([
      { href: '/app/', current: 'page' },
      { href: '/app/next', current: null },
    ]);
  });
});

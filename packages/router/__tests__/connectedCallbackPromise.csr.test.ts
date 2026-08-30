import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { bootstrapRouter } from '../src/exports';
import type { Router } from '../src/components/Router';

/**
 * CSR 経路の connectedCallbackPromise（readiness プロトコル）の決着。
 *
 * - ストリーミング型パーサ（happy-dom の `document.body.innerHTML = ...`）は開始タグの
 *   時点で connectedCallback を呼ぶため、子 `<template>` がまだ無い。SSR 経路と同じく
 *   1 microtask 譲ってから初期化しないと「template が無い」で初期化が落ちる。
 * - 初期化の失敗は reject として伝わる。配管が無いと Promise が永久に未決着になり、
 *   waitForReady（@wcstack/server / @wcstack/testing）が無言でハングする。
 */
beforeAll(() => {
  bootstrapRouter();
  history.replaceState(null, '', '/');
});

afterEach(() => {
  document.querySelectorAll('a').forEach((anchor) => anchor.remove());
  document.body.innerHTML = '';
});

describe('connectedCallbackPromise（CSR）', () => {
  it('document.body.innerHTML で挿入しても初回ルート適用後に resolve する', async () => {
    document.body.innerHTML = `
      <wcs-router>
        <template>
          <wcs-route path="/"><p id="home">home</p></wcs-route>
          <wcs-route fallback><p id="nf">not found</p></wcs-route>
        </template>
      </wcs-router>
      <wcs-outlet></wcs-outlet>
    `;
    const router = document.querySelector('wcs-router') as Router;
    await router.connectedCallbackPromise;
    expect(document.querySelector('wcs-outlet #home')).not.toBeNull();
    expect(document.querySelector('#nf')).toBeNull();
  });

  it('初期化の失敗（template 無し）は reject として伝わる', async () => {
    const router = document.createElement('wcs-router') as Router;
    const settled = router.connectedCallbackPromise.then(() => 'resolved', (e: Error) => `rejected: ${e.message}`);
    document.body.appendChild(router);
    await expect(settled).resolves.toMatch(/rejected: .*<template>/);
  });
});

/**
 * 初回描画の内容は「state の走査時に既に document に居る」前提で binder に渡していなかった。
 * しかし `json=` の state は I/O 無しで走査を終えるので、bootstrap を先に済ませてから HTML を
 * 流し込むハーネス（@wcstack/testing の mount()）では state の走査が router の挿入より先に
 * 完了し得る。binder が既に居るときは初回内容も差し出す（bind は冪等）。居なければ渡さない
 * — state を読まないページで保留キューにノードを溜めないため。
 */
describe('初回ルート内容の binder への差し出し（CSR）', () => {
  const BINDER_KEY = Symbol.for('wcstack.binder');
  const PENDING_KEY = Symbol.for('wcstack.binder.pending');
  const ROUTES = `
    <wcs-router>
      <template><wcs-route path="/"><p id="home" data-wcs="textContent: who">home</p></wcs-route></template>
    </wcs-router>
    <wcs-outlet></wcs-outlet>
  `;

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[BINDER_KEY];
  });

  it('binder が居れば初回内容を bind() に渡す', async () => {
    const bound: Node[] = [];
    (globalThis as Record<symbol, unknown>)[BINDER_KEY] = {
      protocol: 'wcs-binder',
      version: 1,
      bind(subtree: Node) { bound.push(subtree); },
    };
    document.body.innerHTML = ROUTES;
    await (document.querySelector('wcs-router') as Router).connectedCallbackPromise;
    expect(bound.some((n) => (n as Element).id === 'home')).toBe(true);
  });

  it('binder が居なければ保留キューに溜めない（後から来る state の走査に任せる）', async () => {
    const queue = ((globalThis as Record<symbol, unknown>)[PENDING_KEY] ??= []) as Node[];
    const before = queue.length;
    document.body.innerHTML = ROUTES;
    await (document.querySelector('wcs-router') as Router).connectedCallbackPromise;
    expect(queue.length).toBe(before);
  });
});

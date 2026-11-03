import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Router } from '../src/components/Router';
import { bindSubtree, flushPendingBinds } from '../src/protocol/binder';
import './setup';

/**
 * binder の居ないページの保留キュー（protocol/binder.ts、docs/formal-methods-study.md §8）。
 * ルーターはルートを置くたびに中身を差し出すので、キューが文書の中にあるものを 1 回ずつしか持たないこと、
 * 後から来た binder に文書の中にあるものだけを渡すことを確かめる。
 */
const BINDER_KEY = Symbol.for('wcstack.binder');
const PENDING_KEY = Symbol.for('wcstack.binder.pending');
const slot = globalThis as unknown as Record<symbol, unknown>;
const queue = (): Node[] => (slot[PENDING_KEY] as Node[] | undefined) ?? [];

describe('binder の保留キュー', () => {
  // basename は <base> から読む（無ければ文書の URL — 最初のページが /a だと basename が /a になる）
  const base = document.createElement('base');
  beforeAll(() => {
    base.href = '/';
    document.head.appendChild(base);
  });
  afterAll(() => {
    base.remove();
    history.replaceState(null, '', '/');
  });
  afterEach(() => {
    delete slot[BINDER_KEY];
    delete slot[PENDING_KEY];
    document.body.innerHTML = '';
  });

  it('同じ部分木は 1 回だけ積み、文書から外れたものは次に積むときに捨てる', () => {
    const a = document.createElement('p');
    const b = document.createElement('p');
    document.body.append(a, b);
    expect(bindSubtree(a)).toBe(false);
    bindSubtree(a);
    bindSubtree(b);
    expect(queue()).toEqual([a, b]);
    a.remove();
    bindSubtree(b);
    expect(queue()).toEqual([b]);
  });

  it('binder の無いページでナビゲーションを重ねても、キューは画面にあるものだけ', async () => {
    history.replaceState(null, '', '/a');
    document.body.innerHTML = `
      <wcs-router>
        <template>
          <wcs-route path="/a"><p data-page="a">a</p></wcs-route>
          <wcs-route path="/b"><p data-page="b">b</p></wcs-route>
        </template>
      </wcs-router>
      <wcs-outlet></wcs-outlet>`;
    const router = document.querySelector('wcs-router') as Router;
    await router.connectedCallbackPromise;
    // 4.14 までは 100 件（中身は 2 つのノード）に伸びた
    for (let i = 0; i < 100; i++) await router.navigate(i % 2 === 0 ? '/b' : '/a');
    expect(queue().map((node) => (node as Element).getAttribute('data-page'))).toEqual(['a']);
  });

  it('後から来た binder には、文書の中にまだあるものだけを渡す', () => {
    const shown = document.createElement('p');
    const hidden = document.createElement('p');
    document.body.append(shown, hidden);
    bindSubtree(shown);
    bindSubtree(hidden);
    // 積んだ後に隠れたルートの中身
    hidden.remove();
    const bound: Node[] = [];
    slot[BINDER_KEY] = { protocol: 'wcs-binder', version: 1, bind: (subtree: Node) => bound.push(subtree) };
    flushPendingBinds();
    expect(bound).toEqual([shown]);
    expect(queue()).toEqual([]);
  });
});

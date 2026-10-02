import { describe, it, expect, beforeAll, vi } from 'vitest';
import './setup';
// @ts-ignore - the committed 3.x bundle (packages/state/dist)
import { bootstrapState } from '../../state/dist/index.esm.js';
import type { Router } from '../src/components/Router';
import { settle } from './routeRange.state.shared';
import { BINDER_KEY } from '../src/protocol/binder';

/**
 * LayoutOutlet は置いた中身を binder へ渡す（layoutOutlet.binder.test.ts）。着地のルートでは、
 * state の最初の走査が同じ中身をすでに束ねているので、3.x の binder には同じノードを
 * もう一度渡すことになる。イベントの束縛が二重になれば 1 回のクリックで 2 回数えるので、
 * それで二重に束ねていないことを確かめる。
 *
 * router は文書に無いノード（読み込み待ちの <wcs-layout> の中のルートの内容）を binder に
 * 渡さない。3.x はそれを切り離されたまま束ね、イベントの束縛が「disconnected binding」の
 * 未処理の拒否になっていた。置かれた後で outlet が渡す。
 */

beforeAll(() => bootstrapState());

const LAYOUT = `<div class="frame"><button class="lb" data-wcs="onclick: inc">L</button><b class="lt">{{ count }}</b><slot></slot></div>`;

/** `layoutAttr`: the layout from a <template> in the page (`layout=`) or a fetched file (`src=`) */
const page = (layoutAttr: string): string => `<template id="count-layout">${LAYOUT}</template>
<wcs-state></wcs-state>
<wcs-router><template>
  <wcs-route path="/"><h1>home</h1></wcs-route>
  <wcs-route path="/l"><wcs-layout name="m" ${layoutAttr}><wcs-route path="x"><button class="rb" data-wcs="onclick: inc">R</button><p class="x">{{ count }}</p><ul><template data-wcs="for: items"><li class="li">{{ . }}</li></template></ul></wcs-route></wcs-layout></wcs-route>
</template></wcs-router>`;

const view = (): string => {
  const q = (s: string) => Array.from(document.querySelectorAll(s), (n) => n.textContent).join('/');
  return `lt=[${q('b.lt')}] x=[${q('p.x')}] li=[${q('li.li')}]`;
};

interface Run { seen: string[]; errors: string[]; handedFrame: boolean; handedDetached: number }

/**
 * `slowLayout`: the layout comes from `src=`, and its fetch answers only after the state has built
 * its bindings (a slow network; the router landed before the state built).
 */
async function clickAndLeaveAndReturn(landing: string, slowLayout = false): Promise<Run> {
  history.replaceState(null, '', landing);
  const base = document.createElement('base');
  base.setAttribute('href', '/');
  document.head.appendChild(base);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetchSpy = slowLayout
    ? vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await gate;
      return { ok: true, status: 200, text: async () => LAYOUT } as Response;
    })
    : null;
  document.body.innerHTML = page(slowLayout ? 'src="/slow-count-layout.html"' : 'layout="count-layout"');
  const errors: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
  // the binder 3.x installed: record what is handed to it, and whether it was in the document then
  const binder = (globalThis as Record<symbol, any>)[BINDER_KEY];
  const bind = binder.bind;
  const handed: Node[] = [];
  let handedDetached = 0;
  binder.bind = (node: Node, options?: unknown) => {
    handed.push(node);
    if (!node.isConnected) handedDetached++;
    return bind(node, options);
  };
  const click = async (selector: string) => {
    (document.querySelector(selector) as HTMLElement).click();
    await settle();
  };
  try {
    await settle();
    const el = document.querySelector('wcs-state') as any;
    el.setInitialState({ count: 0, items: ['a', 'b'], inc() { (this as { count: number }).count++; } });
    await el.connectedCallbackPromise;
    await settle();
    release();
    await settle();
    const router = document.querySelector('wcs-router') as Router;
    if (landing !== '/l/x') {
      await router.navigate('/l/x');
      await settle();
    }
    const seen = [view()];
    await click('button.lb');
    await click('button.rb');
    seen.push(view());
    await router.navigate('/');
    await settle();
    await router.navigate('/l/x');
    await settle();
    await click('button.lb');
    await click('button.rb');
    seen.push(view());
    return { seen, errors, handedFrame: handed.some((n) => (n as Element).classList?.contains('frame')), handedDetached };
  } finally {
    console.error = original;
    binder.bind = bind;
    fetchSpy?.mockRestore();
    document.body.innerHTML = '';
    base.remove();
    history.replaceState(null, '', '/');
  }
}

const COUNTED = [
  'lt=[0] x=[0] li=[a/b]',
  'lt=[2] x=[2] li=[a/b]',
  'lt=[4] x=[4] li=[a/b]',
];

describe('LayoutOutlet と @wcstack/state 3.x（packages/state/dist）', () => {
  it('着地のルート: state の走査が束ねた中身を outlet がもう一度渡しても二重に束ねない（1 クリックで 1 回）', async () => {
    const run = await clickAndLeaveAndReturn('/l/x');
    expect(run.seen).toEqual(COUNTED);
    expect(run.errors).toEqual([]);
    expect(run.handedFrame).toBe(true);
    expect(run.handedDetached).toBe(0);
  });

  it('遷移で入ったレイアウト: 初めての入場でレイアウトのテンプレートとルートの内容を束ね、往復しても 1 クリックで 1 回', async () => {
    const run = await clickAndLeaveAndReturn('/');
    expect(run.seen).toEqual(COUNTED);
    expect(run.errors).toEqual([]);
    expect(run.handedFrame).toBe(true);
    expect(run.handedDetached).toBe(0);
  });

  it('レイアウトのテンプレートが state の初期構築より後に届く着地（遅い src=）: 文書に無いルートの内容は渡さず、置かれた後で束ねる', async () => {
    const run = await clickAndLeaveAndReturn('/l/x', true);
    expect(run.seen).toEqual(COUNTED);
    expect(run.errors).toEqual([]);
    expect(run.handedFrame).toBe(true);
    expect(run.handedDetached).toBe(0);
  });
});

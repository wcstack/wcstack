import { expect } from 'vitest';
import type { Router } from '../src/components/Router';

/**
 * `<wcs-route>` の直下の構造テンプレートを、state がページの走査で描く形（router が着地の
 * ルートを先に挿入し、state が後からマウントする — CDN の auto でふつうの順序）。
 * 3.x の state（packages/state/dist、routeRange.state3x.test.ts）と state-next（routeRange.stateNext.test.ts）の両方で流す。
 */
export const ROUTES = `<wcs-state></wcs-state>
<wcs-router><template>
  <wcs-route path="/"><h2>list</h2><template data-wcs="for: items"><p class="row">{{ . }}</p></template><template data-wcs="if: on"><b class="on">on</b></template></wcs-route>
  <wcs-route path="/other"><h2>other</h2></wcs-route>
</template></wcs-router>`;

const flush = () => new Promise((r) => setTimeout(r, 0));
export const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await flush(); };
export const shown = (): string => Array.from(document.querySelectorAll('h2, p.row, b.on'), (n) => n.textContent).join(',');

/** 着地の後に state がマウントし、退出・再入場・退出中の書き込みを経ても、行と枝が残らず重ならない */
export async function landingThenLeave(write: (el: any, items: string[], on: boolean) => Promise<void>): Promise<string[]> {
  history.replaceState(null, '', '/');
  document.body.innerHTML = ROUTES;
  const errors: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
  try {
    await settle();
    const el = document.querySelector('wcs-state') as any;
    el.setInitialState({ items: ['a', 'b'], on: true });
    await el.connectedCallbackPromise;
    await settle();
    expect(shown()).toBe('list,a,b,on');
    const router = document.querySelector('wcs-router') as Router;
    await router.navigate('/other');
    await settle();
    expect(shown()).toBe('other');
    // the rows and the branch are kept with the route, and live: a write while it is hidden shows when it comes back
    await write(el, ['c'], false);
    await router.navigate('/');
    await settle();
    expect(shown()).toBe('list,c');
    await write(el, ['c', 'd'], true);
    expect(shown()).toBe('list,c,d,on');
    await router.navigate('/other');
    await settle();
    expect(shown()).toBe('other');
    expect(document.querySelectorAll('wcs-outlet template').length).toBe(0);
    return errors;
  } finally {
    console.error = original;
    document.body.innerHTML = '';
  }
}

/** 入れ子のルート（親の直下の if:+else:、子の直下の for:） */
export const NESTED = `<wcs-state></wcs-state>
<wcs-router><template>
  <wcs-route path="/"><h2>root</h2></wcs-route>
  <wcs-route path="/p"><h2>P</h2><template data-wcs="if: on"><i class="on">on</i></template><template data-wcs="else:"><i class="off">off</i></template>
    <wcs-route path="a"><h3>A</h3><template data-wcs="for: items"><b class="row">{{ . }}</b></template></wcs-route>
    <wcs-route path="b"><h3>B</h3></wcs-route>
  </wcs-route>
  <wcs-route path="/q"><h2>Q</h2></wcs-route>
</template></wcs-router>`;

export const nestedShown = (): string => Array.from(document.querySelectorAll('h2, h3, .on, .off, .row'), (n) => n.textContent).join(',');

/**
 * 着地は別のルート（`land`）で、state が束ねた後に遷移でルートへ入る — router は内容を binder へ
 * 渡す。各遷移の後の表示と、console.error に出たものを返す。
 */
export async function enterByNavigation(land: string, visits: string[], state: Record<string, unknown>): Promise<{ seen: string[]; errors: string[] }> {
  history.replaceState(null, '', land);
  const base = document.createElement('base');
  base.setAttribute('href', '/');
  document.head.appendChild(base);
  document.body.innerHTML = NESTED;
  const errors: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
  try {
    await settle();
    const el = document.querySelector('wcs-state') as any;
    el.setInitialState(state);
    await el.connectedCallbackPromise;
    await settle();
    const router = document.querySelector('wcs-router') as Router;
    const seen = [nestedShown()];
    for (const to of visits) {
      await router.navigate(to);
      await settle();
      seen.push(nestedShown());
    }
    expect(document.querySelectorAll('wcs-outlet .row').length).toBeLessThanOrEqual(2);
    return { seen, errors };
  } finally {
    console.error = original;
    document.body.innerHTML = '';
    base.remove();
    history.replaceState(null, '', '/');
  }
}

/** レイアウトの中のルート。`shadow` でレイアウトを shadow root にする */
export const LAYOUT_PAGE = (shadow: boolean): string => `<template id="range-lay"><div class="frame"><b class="lt">{{ msg }}</b><slot></slot></div></template>
<wcs-state></wcs-state>
<wcs-router><template>
  <wcs-route path="/"><h1>home</h1></wcs-route>
  <wcs-route path="/l"><wcs-layout name="m" layout="range-lay"${shadow ? ' enable-shadow-root' : ''}><wcs-route path="x"><p class="x">{{ msg }}</p><span class="y" data-wcs="textContent: msg"></span><ul><template data-wcs="for: items"><li class="li">{{ . }}</li></template></ul></wcs-route></wcs-layout></wcs-route>
  <wcs-route path="/m"><p class="m">{{ msg }}</p></wcs-route>
</template></wcs-router>`;

export const layoutShown = (): string => {
  const q = (s: string) => Array.from(document.querySelectorAll(s), (n) => n.textContent).join('/');
  return `x=[${q('p.x')}] y=[${q('span.y')}] li=[${q('li.li')}] m=[${q('p.m')}] lt=[${q('b.lt')}]`;
};

/** 着地は `/`、state が束ねた後に遷移でレイアウトの中のルートへ入り、出入りする */
export async function enterLayoutByNavigation(shadow: boolean): Promise<{ seen: string[]; errors: string[] }> {
  history.replaceState(null, '', '/');
  document.body.innerHTML = LAYOUT_PAGE(shadow);
  const errors: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
  try {
    await settle();
    const el = document.querySelector('wcs-state') as any;
    el.setInitialState({ msg: 'hi', items: ['a', 'b'] });
    await el.connectedCallbackPromise;
    await settle();
    const router = document.querySelector('wcs-router') as Router;
    const seen: string[] = [];
    for (const to of ['/l/x', '/m', '/', '/l/x']) {
      await router.navigate(to);
      await settle();
      seen.push(layoutShown());
    }
    return { seen, errors };
  } finally {
    console.error = original;
    document.body.innerHTML = '';
  }
}

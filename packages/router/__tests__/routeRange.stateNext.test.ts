import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import './setup';
import { bootstrapState } from '../../state-next/src/exports';
import { engines } from '../../state-next/src/dom/mount';
import { enterByNavigation, enterLayoutByNavigation, landingThenLeave, ROUTES, settle, shown } from './routeRange.state.shared';

beforeAll(() => bootstrapState());
// each test puts a new root <wcs-state> on the document: the previous one's engine must not take the
// content the router hands over before the new one mounts (one state per page in real use)
afterEach(() => { engines.delete(document); });

describe('ルートの範囲と state-next（4.0）', () => {
  it('着地のルートで state が描いた行・枝は、退出すると残らず、戻ると重ならずに戻る', async () => {
    const errors = await landingThenLeave(async (el, items, on) => {
      el.createState('writable', (s: any) => { s.items = items; s.on = on; });
      await settle();
    });
    expect(errors).toEqual([]);
  });
});

describe('範囲を持ち運ぶ宣言（binder の range）と state-next: 遷移で入ったルートの直下の構造テンプレート', () => {
  it('遷移で入ったルートと入れ子のルートの直下の for: / if:+else: を描き、退出で消え、再入場で重ならない', async () => {
    const { seen, errors } = await enterByNavigation('/q', ['/p/a', '/p/b', '/q', '/p/a'], { items: ['x', 'y'], on: true });
    expect(seen).toEqual(['Q', 'P,on,A,x,y', 'P,on,B', 'Q', 'P,on,A,x,y']);
    expect(errors).toEqual([]);
  });

  it('if:+else: の連鎖は 1 つとして描き（else: が別に渡されても重ならない）、条件の変化に追従する', async () => {
    const { seen, errors } = await enterByNavigation('/q', ['/p/b'], { items: [], on: false });
    expect(seen).toEqual(['Q', 'P,off,B']);
    expect(errors).toEqual([]);
  });

  it('state が先に束ねたページ（json=）でも、着地のルートの直下のテンプレートを描く（router が初期の内容を宣言付きで渡す）', async () => {
    history.replaceState(null, '', '/');
    document.body.innerHTML = ROUTES.replace('<wcs-state></wcs-state>', `<wcs-state json='{"items":["a","b"],"on":true}'></wcs-state>`);
    const errors: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
    try {
      await (document.querySelector('wcs-state') as any).connectedCallbackPromise;
      await settle();
      expect(shown()).toBe('list,a,b,on');
      const router = document.querySelector('wcs-router') as any;
      await router.navigate('/other');
      await settle();
      expect(shown()).toBe('other');
      await router.navigate('/');
      await settle();
      expect(shown()).toBe('list,a,b,on');
      expect(errors).toEqual([]);
    } finally {
      console.error = original;
      document.body.innerHTML = '';
    }
  });

  it('レイアウト（wcs-layout）の中のルートの直下のテンプレートも、往復で重ならない（着地で描いたもの）', async () => {
    // (遷移で入ったレイアウトの中のルートの内容は、binder に渡す時点ではまだレイアウトの outlet に
    // 入っていない — レイアウトのテンプレートの読み込みを待つ — ので、宣言とは別に束ねられない。既存の制限)
    const layout = document.createElement('template');
    layout.id = 'range-state-layout';
    layout.innerHTML = `<div class="frame"><slot></slot></div>`;
    document.head.appendChild(layout);
    const base = document.createElement('base');
    base.setAttribute('href', '/');
    document.head.appendChild(base);
    history.replaceState(null, '', '/l/x');
    document.body.innerHTML = `<wcs-state></wcs-state><wcs-router><template>
      <wcs-route path="/"><h2>root</h2></wcs-route>
      <wcs-route path="/l"><wcs-layout name="m" layout="range-state-layout"><wcs-route path="x"><h3>X</h3><template data-wcs="for: items"><b class="row">{{ . }}</b></template></wcs-route></wcs-layout></wcs-route>
    </template></wcs-router>`;
    try {
      await settle();
      const el = document.querySelector('wcs-state') as any;
      el.setInitialState({ items: ['x', 'y'] });
      await el.connectedCallbackPromise;
      await settle();
      const router = document.querySelector('wcs-router') as any;
      const rows = () => Array.from(document.querySelectorAll('.frame .row'), (n) => n.textContent).join(',');
      expect(rows()).toBe('x,y');
      await router.navigate('/');
      await settle();
      expect(document.querySelectorAll('.row').length).toBe(0);
      await router.navigate('/l/x');
      await settle();
      expect(rows()).toBe('x,y');
    } finally {
      layout.remove();
      base.remove();
      document.body.innerHTML = '';
      history.replaceState(null, '', '/');
    }
  });

  it('SSR の往復: サーバで描いた直下のテンプレートの行と枝を採用し、往復で重ならない', async () => {
    const markup = ROUTES
      .replace('<wcs-state></wcs-state>', `<wcs-state enable-ssr json='{"items":["a","b"],"on":true}'></wcs-state>`)
      .replace('<wcs-router>', '<wcs-router enable-ssr>');
    history.replaceState(null, '', '/');
    document.documentElement.setAttribute('data-wcs-server', '');
    let html = '';
    try {
      document.body.innerHTML = markup;
      await (document.querySelector('wcs-state') as any).connectedCallbackPromise;
      await (document.querySelector('wcs-router') as any).connectedCallbackPromise;
      await settle();
      (globalThis as any)[Symbol.for('wcstack.ssr.snapshotBuilder')].build(document);
      html = document.body.innerHTML;
      document.body.innerHTML = '';
    } finally {
      document.documentElement.removeAttribute('data-wcs-server');
    }
    expect(html).toContain('<p class="row">a</p>');
    const errors: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
    try {
      document.body.innerHTML = html;
      const rowA = document.querySelector('p.row');
      await (document.querySelector('wcs-state') as any).connectedCallbackPromise;
      await (document.querySelector('wcs-router') as any).connectedCallbackPromise;
      await settle();
      expect(shown()).toBe('list,a,b,on');
      expect(document.querySelector('p.row')).toBe(rowA);
      const router = document.querySelector('wcs-router') as any;
      await router.navigate('/other');
      await settle();
      expect(shown()).toBe('other');
      await router.navigate('/');
      await settle();
      expect(shown()).toBe('list,a,b,on');
      expect(errors).toEqual([]);
    } finally {
      console.error = original;
      document.body.innerHTML = '';
    }
  });
});

describe('レイアウトの中のルートに遷移で入る（state-next）', () => {
  it('初めての入場で、ルートの内容とレイアウトのテンプレート自身の束縛を束ね、往復で重ならない', async () => {
    const { seen, errors } = await enterLayoutByNavigation(false);
    expect(seen).toEqual([
      'x=[hi] y=[hi] li=[a/b] m=[] lt=[hi]',
      'x=[] y=[] li=[] m=[hi] lt=[]',
      'x=[] y=[] li=[] m=[] lt=[]',
      'x=[hi] y=[hi] li=[a/b] m=[] lt=[hi]',
    ]);
    expect(errors).toEqual([]);
  });

  it('shadow のレイアウト: スロットへ投影するルートの内容は束ね、shadow root の中のテンプレートは対象外のまま', async () => {
    const { seen, errors } = await enterLayoutByNavigation(true);
    expect(seen[0]).toBe('x=[hi] y=[hi] li=[a/b] m=[] lt=[]');
    expect(seen[3]).toBe('x=[hi] y=[hi] li=[a/b] m=[] lt=[]');
    expect(errors).toEqual([]);
  });
});

describe('入れ子のレイアウト（state-next）', () => {
  it('レイアウトの中のルートの中のレイアウトにも、遷移で初めて入ったときから束ね、往復で重ならない', async () => {
    history.replaceState(null, '', '/');
    document.body.innerHTML = `<template id="outer-lay"><section class="outer"><b class="lo">{{ msg }}</b><slot></slot></section></template>
<template id="inner-lay"><div class="inner"><i class="li2">{{ msg }}</i><slot></slot></div></template>
<wcs-state></wcs-state>
<wcs-router><template>
  <wcs-route path="/"><h1>home</h1></wcs-route>
  <wcs-route path="/a"><wcs-layout name="o" layout="outer-lay"><wcs-route path="b"><wcs-layout name="i" layout="inner-lay"><wcs-route path="c"><p class="c">{{ msg }}</p><template data-wcs="for: items"><u class="row">{{ . }}</u></template></wcs-route></wcs-layout></wcs-route></wcs-layout></wcs-route>
</template></wcs-router>`;
    const errors: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
    try {
      await settle();
      const el = document.querySelector('wcs-state') as any;
      el.setInitialState({ msg: 'hi', items: ['a', 'b'] });
      await el.connectedCallbackPromise;
      await settle();
      const router = document.querySelector('wcs-router') as any;
      const q = (s: string) => Array.from(document.querySelectorAll(s), (n) => n.textContent).join('/');
      const view = () => `lo=[${q('b.lo')}] li=[${q('i.li2')}] c=[${q('p.c')}] rows=[${q('u.row')}]`;
      const seen: string[] = [];
      for (const to of ['/a/b/c', '/', '/a/b/c']) {
        await router.navigate(to);
        await settle();
        seen.push(view());
      }
      expect(seen).toEqual(['lo=[hi] li=[hi] c=[hi] rows=[a/b]', 'lo=[] li=[] c=[] rows=[]', 'lo=[hi] li=[hi] c=[hi] rows=[a/b]']);
      expect(errors).toEqual([]);
    } finally {
      console.error = original;
      document.body.innerHTML = '';
    }
  });
});

describe('パラメータの変化で表示中のルートをもう一度表示する（router 3.5 の持ち出して戻す、state-next）', () => {
  it('直下の for: / if:+else: の行と枝は並びを保って戻り、重ならず、遷移で入った後も書き込みに追従する', async () => {
    history.replaceState(null, '', '/');
    document.body.innerHTML = `<wcs-state></wcs-state>
<wcs-router><template>
  <wcs-route path="/"><h2>root</h2></wcs-route>
  <wcs-route path="/u/:id"><h2>U</h2><template data-wcs="for: items"><p class="row">{{ . }}</p></template><template data-wcs="if: on"><b class="on">on</b></template><template data-wcs="else:"><b class="on">off</b></template><footer class="f">F</footer></wcs-route>
</template></wcs-router>`;
    const errors: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
    try {
      await settle();
      const el = document.querySelector('wcs-state') as any;
      el.setInitialState({ items: ['a', 'b'], on: true });
      await el.connectedCallbackPromise;
      await settle();
      const router = document.querySelector('wcs-router') as any;
      const view = () => Array.from(document.querySelectorAll('h2, p.row, b.on, footer.f'), (n) => n.textContent).join(',');
      const seen: string[] = [];
      for (const to of ['/u/1', '/u/2', '/u/3']) {
        await router.navigate(to);
        await settle();
        seen.push(view());
      }
      expect(seen).toEqual(['U,a,b,on,F', 'U,a,b,on,F', 'U,a,b,on,F']);
      el.createState('writable', (s: any) => { s.items = ['c']; s.on = false; });
      await settle();
      expect(view()).toBe('U,c,off,F');
      await router.navigate('/u/4');
      await settle();
      expect(view()).toBe('U,c,off,F');
      await router.navigate('/');
      await settle();
      expect(view()).toBe('root');
      expect(errors).toEqual([]);
    } finally {
      console.error = original;
      document.body.innerHTML = '';
    }
  });
});

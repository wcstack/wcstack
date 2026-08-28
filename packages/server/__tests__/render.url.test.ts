import { describe, it, expect } from 'vitest';
import { renderToString } from '../src/render';

// url / baseHref オプションと URL 系グローバル（window / location / history）の契約
// （docs/ssr-router-design.md §3.1）。
// server はプロトコルだけを知る設計のため、ここでは実パッケージではなく
// テスト内で定義したモック custom element で契約を検証する（同 §7）。

/** bootstrap 時点の globalThis.HTMLElement を親にしたモック要素を登録する */
function defineElement(
  tagName: string,
  render: (el: any) => void | Promise<void>,
  opts?: { hasConnectedCallbackPromise?: boolean }
): () => void {
  return () => {
    const ctor = class extends (globalThis as any).HTMLElement {
      static hasConnectedCallbackPromise = opts?.hasConnectedCallbackPromise ?? false;
      _resolve: (() => void) | null = null;
      connectedCallbackPromise = new Promise<void>((resolve) => {
        this._resolve = resolve;
      });
      async connectedCallback() {
        await render(this);
        this._resolve?.();
      }
    };
    (globalThis as any).customElements.define(tagName, ctor);
  };
}

describe('url オプション', () => {
  it('window.location がリクエスト URL を指す', async () => {
    const bootstrap = defineElement('x-loc', (el) => {
      el.textContent = `${(globalThis as any).window.location.pathname}${(globalThis as any).window.location.search}`;
    });
    const result = await renderToString(`<x-loc></x-loc>`, {
      url: 'http://localhost:3000/products/1?page=2',
      bootstraps: [bootstrap],
    });
    expect(result).toContain('/products/1?page=2');
  });

  it('location / history がグローバルに載る', async () => {
    const bootstrap = defineElement('x-glob', (el) => {
      const g = globalThis as any;
      el.textContent = [
        g.location?.pathname,
        typeof g.history?.pushState,
        g.window === g.window?.window ? 'self' : 'broken',
      ].join('|');
    });
    const result = await renderToString(`<x-glob></x-glob>`, {
      url: 'http://localhost:3000/deep/path',
      bootstraps: [bootstrap],
    });
    expect(result).toContain('/deep/path|function|self');
  });

  it('レンダリング後にグローバルは復元される', async () => {
    await renderToString(`<p>x</p>`, { url: 'http://localhost:3000/a' });
    expect((globalThis as any).window).toBeUndefined();
    expect((globalThis as any).location).toBeUndefined();
    expect((globalThis as any).history).toBeUndefined();
  });

  it('url 指定時は <base href="/"> が注入され baseURI がルートを指す', async () => {
    const bootstrap = defineElement('x-base', (el) => {
      const doc = (globalThis as any).document;
      const base = doc.querySelector('base[href]');
      el.textContent = `${base ? 'base' : 'nobase'}:${doc.baseURI}`;
    });
    const result = await renderToString(`<x-base></x-base>`, {
      url: 'http://localhost:3000/products/1',
      bootstraps: [bootstrap],
    });
    expect(result).toContain('base:http://localhost:3000/');
    expect(result).not.toContain('/products/1<');
  });

  it('baseHref でサブパス配備の base を明示できる', async () => {
    const bootstrap = defineElement('x-basehref', (el) => {
      el.textContent = (globalThis as any).document.baseURI;
    });
    const result = await renderToString(`<x-basehref></x-basehref>`, {
      url: 'http://localhost:3000/app/products/1',
      baseHref: '/app/',
      bootstraps: [bootstrap],
    });
    expect(result).toContain('http://localhost:3000/app/');
  });

  it('url 未指定なら base は注入されない（従来挙動）', async () => {
    const bootstrap = defineElement('x-nobase', (el) => {
      const base = (globalThis as any).document.querySelector('base[href]');
      el.textContent = base ? 'base' : 'nobase';
    });
    const result = await renderToString(`<x-nobase></x-nobase>`, {
      bootstraps: [bootstrap],
    });
    expect(result).toContain('nobase');
  });

  it('baseUrl 省略時は url の origin が相対 URL 解決の既定になる', async () => {
    const bootstrap = defineElement('x-rel', (el) => {
      // installBaseUrl のパッチは "/" 始まり単独引数の URL を base で解決する
      el.textContent = new URL('/api/items').href;
    });
    const result = await renderToString(`<x-rel></x-rel>`, {
      url: 'http://localhost:4000/products',
      bootstraps: [bootstrap],
    });
    expect(result).toContain('http://localhost:4000/api/items');
  });
});

describe('待機プロトコル（URL を持つ非同期要素）', () => {
  it('hasConnectedCallbackPromise の要素の非同期初期化を待ってから返す', async () => {
    const bootstrap = defineElement(
      'x-async-route',
      async (el) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        el.textContent = `resolved:${(globalThis as any).location.pathname}`;
      },
      { hasConnectedCallbackPromise: true }
    );
    const result = await renderToString(`<x-async-route></x-async-route>`, {
      url: 'http://localhost:3000/users/42',
      bootstraps: [bootstrap],
    });
    expect(result).toContain('resolved:/users/42');
  });
});

describe('binder pending queue の後始末', () => {
  it('引き取り手のない保留ノードはレンダリング後に残らない', async () => {
    const PENDING_KEY = Symbol.for('wcstack.binder.pending');
    const bootstrap = defineElement('x-offer', (el) => {
      // binder 不在ページで挿入側が bindSubtree した状況を再現する
      const globals = globalThis as Record<symbol, unknown>;
      let queue = globals[PENDING_KEY] as unknown[] | undefined;
      if (queue === undefined) {
        queue = [];
        globals[PENDING_KEY] = queue;
      }
      queue.push(el);
      el.textContent = 'offered';
    });
    const result = await renderToString(`<x-offer></x-offer>`, {
      bootstraps: [bootstrap],
    });
    expect(result).toContain('offered');
    const queue = (globalThis as Record<symbol, unknown>)[PENDING_KEY];
    expect(Array.isArray(queue) ? (queue as unknown[]).length : 0).toBe(0);
  });
});

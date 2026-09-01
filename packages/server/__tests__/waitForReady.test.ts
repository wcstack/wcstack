import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { installGlobals, waitForReady } from '../src/render';

/**
 * waitForReady は renderToString がシリアライズ前に行う待機を切り出したもの
 * （@wcstack/testing の mount() が再利用する）。readiness プロトコルの 2 段
 * — hasConnectedCallbackPromise の安定化ループと getBindingsReady — を、
 * 実 state を使わずプロトコル準拠の最小要素で検証する。
 */
async function withWindow(fn: (document: Document) => Promise<void>): Promise<void> {
  const window = new Window();
  const restore = installGlobals(window);
  try {
    await fn(window.document as unknown as Document);
  } finally {
    restore();
    await window.close();
  }
}

let seq = 0;
const tag = (name: string): string => `wr-${name}-${++seq}`;

describe('waitForReady', () => {
  it('hasConnectedCallbackPromise を持つ要素の connectedCallbackPromise を待つ', async () => {
    await withWindow(async (document) => {
      let resolveReady!: () => void;
      const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
      const name = tag('slow');
      class Slow extends HTMLElement {
        static hasConnectedCallbackPromise = true;
        get connectedCallbackPromise(): Promise<void> { return ready; }
      }
      customElements.define(name, Slow);
      document.body.innerHTML = `<${name}></${name}>`;

      let settled = false;
      const waiting = waitForReady(document as unknown as ParentNode & Node).then(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 0));
      expect(settled).toBe(false);
      resolveReady();
      await waiting;
      expect(settled).toBe(true);
    });
  });

  it('待機中に追加された要素も拾い（安定化ループ）、getBindingsReady はループ後に root ごとに呼ぶ', async () => {
    await withWindow(async (document) => {
      const order: string[] = [];
      const inner = tag('inner');
      class Inner extends HTMLElement {
        static hasConnectedCallbackPromise = true;
        readonly connectedCallbackPromise = Promise.resolve().then(() => { order.push('inner'); });
      }
      const outer = tag('outer');
      class Outer extends HTMLElement {
        static hasConnectedCallbackPromise = true;
        static readonly roots: Node[] = [];
        static getBindingsReady(root: Node): Promise<void> {
          Outer.roots.push(root);
          order.push('bindings');
          return Promise.resolve();
        }
        readonly connectedCallbackPromise: Promise<void>;
        constructor() {
          super();
          this.connectedCallbackPromise = new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
            // $connectedCallback 相当: 待たれている間に別の要素を追加する
            this.appendChild(document.createElement(inner));
            order.push('outer');
          });
        }
      }
      customElements.define(inner, Inner);
      customElements.define(outer, Outer);
      document.body.innerHTML = `<${outer}></${outer}>`;

      const root = document as unknown as ParentNode & Node;
      await waitForReady(root);
      expect(order).toEqual(['outer', 'inner', 'bindings']);
      expect(Outer.roots).toEqual([root]);
    });
  });

  it('プロトコルに従わない要素だけなら即座に解決し、maxIterations で打ち切る', async () => {
    await withWindow(async (document) => {
      document.body.innerHTML = `<div><span></span></div>`;
      await expect(waitForReady(document as unknown as ParentNode & Node)).resolves.toBeUndefined();

      // 完了のたびに新しい要素を足す要素（1 世代 = 1 macrotask）: 上限の世代数で止まる。
      // 3 周で 3 要素を待った時点で解決し、4 つ目の完了は待たない。
      const name = tag('forever');
      let added = 0;
      class Forever extends HTMLElement {
        static hasConnectedCallbackPromise = true;
        readonly connectedCallbackPromise = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => {
          if (added++ < 5) document.body.appendChild(document.createElement(name));
        });
      }
      customElements.define(name, Forever);
      document.body.innerHTML = `<${name}></${name}>`;
      await waitForReady(document as unknown as ParentNode & Node, { maxIterations: 3 });
      expect(added).toBe(3);
      // 残りの世代を流し切ってから window を閉じる
      await new Promise((r) => setTimeout(r, 30));
      expect(added).toBe(6);
    });
  });

  it('ShadowRoot を root にでき、その root で getBindingsReady が呼ばれる', async () => {
    await withWindow(async (document) => {
      const name = tag('shadowed');
      const roots: Node[] = [];
      class Shadowed extends HTMLElement {
        static getBindingsReady(root: Node): Promise<void> { roots.push(root); return Promise.resolve(); }
      }
      customElements.define(name, Shadowed);
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<${name}></${name}>`;
      document.body.appendChild(host);
      await waitForReady(shadow as unknown as ParentNode & Node);
      expect(roots).toEqual([shadow]);
    });
  });

  it('getBindingsReady の reject は伝わる', async () => {
    await withWindow(async (document) => {
      const name = tag('failing');
      class Failing extends HTMLElement {
        static getBindingsReady(): Promise<void> { return Promise.reject(new Error('binding init failed')); }
      }
      customElements.define(name, Failing);
      document.body.innerHTML = `<${name}></${name}>`;
      await expect(waitForReady(document as unknown as ParentNode & Node)).rejects.toThrow('binding init failed');
    });
  });
});

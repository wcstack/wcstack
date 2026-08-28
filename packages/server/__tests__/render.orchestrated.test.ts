import { describe, it, expect, afterEach } from 'vitest';
import { renderToString } from '../src/render';
import { SSR_SNAPSHOT_BUILDER_KEY } from '../src/protocol/ssrSnapshot';

// ssr-snapshot プロトコルの renderer 側契約（docs/ssr-router-design.md §5）。
// builder の実体は @wcstack/state が提供するが、server はプロトコルしか知らない —
// ここではモック builder で「宣言のタイミング」と「呼び出しの位置」を検証する。

const globals = globalThis as Record<symbol, unknown>;

function installMockBuilder(build: (root: Document) => void): void {
  globals[SSR_SNAPSHOT_BUILDER_KEY] = {
    protocol: 'wcs-ssr-snapshot',
    version: 1,
    build,
  };
}

/** 属性値を textContent に写すモック要素を bootstrap として登録する */
function defineAttrProbe(tagName: string): () => void {
  return () => {
    const ctor = class extends (globalThis as any).HTMLElement {
      connectedCallback() {
        this.textContent = `mode:${(globalThis as any).document.documentElement.getAttribute('data-wcs-server')}`;
      }
    };
    (globalThis as any).customElements.define(tagName, ctor);
  };
}

describe('ssr-snapshot プロトコル（orchestrated）', () => {
  afterEach(() => {
    delete globals[SSR_SNAPSHOT_BUILDER_KEY];
  });

  it('builder が居れば data-wcs-server="orchestrated" を宣言する', async () => {
    installMockBuilder(() => {});
    const result = await renderToString(`<x-probe-a></x-probe-a>`, {
      bootstraps: [defineAttrProbe('x-probe-a')],
    });
    expect(result).toContain('mode:orchestrated');
  });

  it('builder が居なければ値は空（従来挙動）', async () => {
    const result = await renderToString(`<x-probe-b></x-probe-b>`, {
      bootstraps: [defineAttrProbe('x-probe-b')],
    });
    expect(result).toContain('mode:');
    expect(result).not.toContain('orchestrated');
  });

  it('プロトコル形状が不正な登録は無視される', async () => {
    globals[SSR_SNAPSHOT_BUILDER_KEY] = { protocol: 'something-else', version: 1, build: () => {} };
    const result = await renderToString(`<x-probe-c></x-probe-c>`, {
      bootstraps: [defineAttrProbe('x-probe-c')],
    });
    expect(result).not.toContain('orchestrated');
  });

  it('version が不正な登録は無視される', async () => {
    globals[SSR_SNAPSHOT_BUILDER_KEY] = { protocol: 'wcs-ssr-snapshot', version: 0, build: () => {} };
    const result = await renderToString(`<x-probe-d></x-probe-d>`, {
      bootstraps: [defineAttrProbe('x-probe-d')],
    });
    expect(result).not.toContain('orchestrated');
  });

  it('build が関数でない登録は無視される', async () => {
    globals[SSR_SNAPSHOT_BUILDER_KEY] = { protocol: 'wcs-ssr-snapshot', version: 1, build: 'x' };
    const result = await renderToString(`<x-probe-e></x-probe-e>`, {
      bootstraps: [defineAttrProbe('x-probe-e')],
    });
    expect(result).not.toContain('orchestrated');
  });

  it('build は全要素の完了後・serialize 直前に render 中の document で呼ばれる', async () => {
    let observedText: string | null = null;
    installMockBuilder((root) => {
      // この時点で非同期要素の内容が確定している
      observedText = root.querySelector('x-late')?.textContent ?? null;
      // build の DOM 変更は出力に載る
      const markerEl = root.createElement('div');
      markerEl.setAttribute('data-built', '');
      markerEl.textContent = 'snapshot';
      root.body.appendChild(markerEl);
    });
    const bootstrap = () => {
      const ctor = class extends (globalThis as any).HTMLElement {
        static hasConnectedCallbackPromise = true;
        _resolve: (() => void) | null = null;
        connectedCallbackPromise = new Promise<void>((resolve) => {
          this._resolve = resolve;
        });
        async connectedCallback() {
          await new Promise((resolve) => setTimeout(resolve, 10));
          this.textContent = 'settled';
          this._resolve?.();
        }
      };
      (globalThis as any).customElements.define('x-late', ctor);
    };
    const result = await renderToString(`<x-late></x-late>`, {
      bootstraps: [bootstrap],
    });
    expect(observedText).toBe('settled');
    expect(result).toContain('data-built');
    expect(result).toContain('snapshot');
  });

  it('build は 1 レンダリングにつき 1 回だけ呼ばれる', async () => {
    let calls = 0;
    installMockBuilder(() => {
      calls++;
    });
    await renderToString(`<p>x</p>`, { bootstraps: [() => {}] });
    expect(calls).toBe(1);
  });
});

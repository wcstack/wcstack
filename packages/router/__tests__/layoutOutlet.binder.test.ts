import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LayoutOutlet } from '../src/components/LayoutOutlet';
import { BINDER_KEY } from '../src/protocol/binder';
import type { ILayout } from '../src/components/types';
import './setup';

/**
 * レイアウトの outlet は、中身（レイアウトのテンプレートと、スロットに入れる子）を自分の light DOM に
 * 置いた後で binder へ渡す（binder プロトコル D5: 挿入の後に渡す）。遷移で入ったルートの内容は、
 * router が渡す時点ではまだ文書の外（レイアウトの読み込みを待っている）にあるため。
 */

const PENDING_KEY = Symbol.for('wcstack.binder.pending');

function layoutOf(html: string, enableShadowRoot: boolean, children: Node[]): ILayout {
  const template = document.createElement('template');
  template.innerHTML = html;
  const holder = document.createElement('div');
  holder.append(...children);
  return {
    name: 'm',
    uuid: 'u',
    enableShadowRoot,
    loadTemplate: vi.fn().mockResolvedValue(template),
    get childNodes() { return holder.childNodes; },
  } as unknown as ILayout;
}

async function connect(layout: ILayout): Promise<LayoutOutlet> {
  const outlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
  outlet.layout = layout;
  document.body.appendChild(outlet);
  await new Promise((r) => setTimeout(r, 0));
  return outlet;
}

describe('LayoutOutlet と binder（中身を置いた後で、範囲を持ち運ぶ宣言付きで渡す）', () => {
  let calls: [Node, unknown][];

  beforeEach(() => {
    document.body.innerHTML = '';
    calls = [];
    (globalThis as Record<symbol, unknown>)[BINDER_KEY] = {
      protocol: 'wcs-binder',
      version: 1,
      bind: (node: Node, options?: unknown) => { calls.push([node, options]); },
    };
  });

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[BINDER_KEY];
  });

  it('shadow でない outlet: テンプレートを置いた直下の要素（スロットに入った子を含むフレーム）を、文書に入った後で渡す', async () => {
    const child = document.createElement('p');
    const outlet = await connect(layoutOf(`<div class="frame"><b>{{ msg }}</b><slot></slot></div>text`, false, [child]));
    const frame = outlet.querySelector('.frame')!;
    expect(frame.contains(child)).toBe(true);
    expect(calls).toEqual([[frame, { range: true }]]);
    expect(frame.isConnected).toBe(true);
  });

  it('shadow の outlet: light DOM に置いた子（スロットへ投影するもの）を渡し、shadow root の中のテンプレートは渡さない', async () => {
    const a = document.createElement('p');
    const b = document.createTextNode('t');
    const outlet = await connect(layoutOf(`<div class="frame"><slot></slot></div>`, true, [a, b]));
    expect(outlet.shadowRoot!.querySelector('.frame')).not.toBeNull();
    expect(calls).toEqual([[a, { range: true }]]);
  });

  it('binder が居ないときは渡さず、保留キューにも溜めない（後から来る state の最初の走査が拾う）', async () => {
    delete (globalThis as Record<symbol, unknown>)[BINDER_KEY];
    const queue = ((globalThis as Record<symbol, unknown>)[PENDING_KEY] as Node[] | undefined) ?? [];
    const before = queue.length;
    await connect(layoutOf(`<div class="frame"><slot></slot></div>`, false, [document.createElement('p')]));
    const after = ((globalThis as Record<symbol, unknown>)[PENDING_KEY] as Node[] | undefined)?.length ?? 0;
    expect(after).toBe(before);
  });
});

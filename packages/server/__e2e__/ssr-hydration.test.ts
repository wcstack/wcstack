/**
 * SSR → ハイドレーション結合テスト
 *
 * 1. サーバー側: renderToString() で HTML を生成
 * 2. クライアント側: happy-dom 環境で bootstrapState() → ハイドレーション
 * 3. 状態変化後の DOM 更新を検証
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { renderToString } from '../src/render';

// クライアント側の bootstrapState は happy-dom 環境のグローバルで動作
import { bootstrapState } from '@wcstack/state';

beforeAll(() => {
  bootstrapState();
});

async function hydrate(ssrHtml: string): Promise<void> {
  document.body.innerHTML = ssrHtml;
  const stateEl = document.querySelector('wcs-state') as any;
  if (stateEl?.connectedCallbackPromise) {
    await stateEl.connectedCallbackPromise;
  }
  await new Promise(resolve => setTimeout(resolve, 300));
}

describe('SSR → ハイドレーション結合テスト', () => {
  it('textContent バインディング: SSR → ハイドレーション → 状態変化', async () => {
    // --- サーバー ---
    const ssrHtml = await renderToString(`
      <wcs-state enable-ssr json='{"message":"Hello SSR"}'></wcs-state>
      <p data-wcs="textContent: message">placeholder</p>
    `);

    // SSR 出力に値が反映されている
    expect(ssrHtml).toContain('>Hello SSR<');
    expect(ssrHtml).toContain('wcs-ssr');

    // --- クライアント ---
    await hydrate(ssrHtml);

    const p = document.querySelector('p')!;
    expect(p.textContent).toBe('Hello SSR');

    // 状態変化
    const stateEl = document.querySelector('wcs-state') as any;
    stateEl.createState('writable', (state: any) => {
      state.message = 'Updated!';
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(p.textContent).toBe('Updated!');
  });

  it('for ブロック: SSR → ハイドレーション → アイテム追加', async () => {
    // --- サーバー ---
    const ssrHtml = await renderToString(`
      <wcs-state enable-ssr json='{"items":[{"name":"Alice"},{"name":"Bob"}]}'></wcs-state>
      <ul>
        <template data-wcs="for: items">
          <li data-wcs="textContent: .name"></li>
        </template>
      </ul>
    `);

    expect(ssrHtml).toContain('>Alice<');
    expect(ssrHtml).toContain('>Bob<');

    // --- クライアント ---
    await hydrate(ssrHtml);

    let items = document.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('Alice');
    expect(items[1].textContent).toBe('Bob');

    // アイテム追加
    const stateEl = document.querySelector('wcs-state') as any;
    stateEl.setInitialState({
      items: [{ name: 'Alice' }, { name: 'Bob' }],
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    stateEl.createState('writable', (state: any) => {
      state.items = [...state.items, { name: 'Charlie' }];
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    items = document.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[2].textContent).toBe('Charlie');
  });

  it('if ブロック: SSR → ハイドレーション → 表示切替', async () => {
    // --- サーバー ---
    const ssrHtml = await renderToString(`
      <wcs-state enable-ssr json='{"show":true}'></wcs-state>
      <template data-wcs="if: show">
        <p class="content">表示中</p>
      </template>
    `);

    expect(ssrHtml).toContain('表示中');

    // --- クライアント ---
    await hydrate(ssrHtml);

    expect(document.querySelector('p.content')).not.toBeNull();

    // false にして非表示
    const stateEl = document.querySelector('wcs-state') as any;
    stateEl.setInitialState({ show: true });
    await new Promise(resolve => setTimeout(resolve, 200));

    stateEl.createState('writable', (state: any) => {
      state.show = false;
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(document.querySelector('p.content')).toBeNull();

    // true にして再表示
    stateEl.createState('writable', (state: any) => {
      state.show = true;
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(document.querySelector('p.content')).not.toBeNull();
  });

  it('Mustache テキスト: SSR → ハイドレーション → 状態変化', async () => {
    // --- サーバー ---
    const ssrHtml = await renderToString(`
      <wcs-state enable-ssr json='{"name":"World"}'></wcs-state>
      <p>Hello {{ name }}!</p>
    `);

    expect(ssrHtml).toContain('World');

    // --- クライアント ---
    await hydrate(ssrHtml);

    const p = document.querySelector('p')!;
    expect(p.textContent).toBe('Hello World!');

    // 状態変化
    const stateEl = document.querySelector('wcs-state') as any;
    stateEl.createState('writable', (state: any) => {
      state.name = 'SSR';
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(p.textContent).toBe('Hello SSR!');
  });

  it('value バインディング: SSR → ハイドレーション', async () => {
    // --- サーバー ---
    const ssrHtml = await renderToString(`
      <wcs-state enable-ssr json='{"name":"Alice"}'></wcs-state>
      <input data-wcs="value: name" />
    `);

    expect(ssrHtml).toContain('value="Alice"');

    // --- クライアント ---
    await hydrate(ssrHtml);

    const input = document.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('Alice');
  });

  it('data-wcs-completed がハイドレーション後に付与される', async () => {
    const ssrHtml = await renderToString(`
      <wcs-state enable-ssr json='{"msg":"test"}'></wcs-state>
      <span data-wcs="textContent: msg">test</span>
    `);

    await hydrate(ssrHtml);

    const span = document.querySelector('span')!;
    expect(span.hasAttribute('data-wcs-completed')).toBe(true);
  });
});

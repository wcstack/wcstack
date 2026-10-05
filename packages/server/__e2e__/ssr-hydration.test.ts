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

  it('if / elseif / else の連鎖のテンプレートの間にコメントがあっても、サーバーの枝の要素をそのまま引き取る → 表示切替', async () => {
    // --- サーバー ---
    const ssrHtml = await renderToString(`
      <wcs-state enable-ssr json='{"mode":"b"}'></wcs-state>
      <template data-wcs="if: mode|eq(a)"><p class="a">A</p></template>
      <!-- the second branch -->
      <template data-wcs="elseif: mode|eq(b)"><p class="b">B</p></template>
      <!-- otherwise --><!-- none -->
      <template data-wcs="else:"><p class="none">none</p></template>
    `);

    expect(ssrHtml).toContain('<p class="b">B</p>');
    expect(ssrHtml).toContain('<!-- the second branch -->');

    // --- クライアント ---
    document.body.innerHTML = ssrHtml;
    // サーバーが描いた枝の要素（パースしたもの）
    const serverP = document.querySelector('p.b');
    expect(serverP).not.toBeNull();
    const stateEl = document.querySelector('wcs-state') as any;
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 300));

    // 捨てて描き直さず、同じ要素が残る
    expect(document.querySelector('p.b')).toBe(serverP);
    expect(document.querySelectorAll('p').length).toBe(1);

    stateEl.createState('writable', (state: any) => { state.mode = 'a'; });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(Array.from(document.querySelectorAll('p')).map(p => p.className)).toEqual(['a']);

    stateEl.createState('writable', (state: any) => { state.mode = 'z'; });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(Array.from(document.querySelectorAll('p')).map(p => p.className)).toEqual(['none']);
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

  it('checked / selectedIndex / textarea / innerHTML: SSR の HTML に入り、ハイドレーション後の書き込みに従う', async () => {
    // --- サーバー ---
    const ssrHtml = await renderToString(`
      <wcs-state enable-ssr json='{"agreed":true,"idx":2,"memo":"Hello","html":"<b>bold</b>"}'></wcs-state>
      <input type="checkbox" data-wcs="checked: agreed" />
      <select data-wcs="selectedIndex: idx"><option>A</option><option>B</option><option>C</option></select>
      <textarea data-wcs="value: memo"></textarea>
      <div data-wcs="innerHTML: html"></div>
    `);

    expect(ssrHtml).toMatch(/<input type="checkbox" data-wcs="checked: agreed" checked="">/);
    expect(ssrHtml).toContain('<option>A</option><option>B</option><option selected="">C</option>');
    expect(ssrHtml).toContain('<textarea data-wcs="value: memo">Hello</textarea>');
    expect(ssrHtml).toContain('<div data-wcs="innerHTML: html"><b>bold</b></div>');

    // --- クライアント ---
    await hydrate(ssrHtml);

    const checkbox = document.querySelector('input') as HTMLInputElement;
    const select = document.querySelector('select') as HTMLSelectElement;
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    const div = document.querySelector('div') as HTMLDivElement;
    expect(checkbox.checked).toBe(true);
    expect(select.selectedIndex).toBe(2);
    expect(textarea.value).toBe('Hello');
    expect(div.innerHTML).toBe('<b>bold</b>');

    const stateEl = document.querySelector('wcs-state') as any;
    stateEl.createState('writable', (state: any) => {
      state.agreed = false;
      state.idx = 0;
      state.memo = 'Updated';
      state.html = '<i>italic</i>';
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    // 引き取った同じ要素が更新される
    expect(document.querySelector('input')).toBe(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(select.selectedIndex).toBe(0);
    expect(textarea.value).toBe('Updated');
    expect(div.innerHTML).toBe('<i>italic</i>');
  });

  it('ハイドレーション後に data-wcs-completed が残らず、バインディングが機能する', async () => {
    const ssrHtml = await renderToString(`
      <wcs-state enable-ssr json='{"msg":"test"}'></wcs-state>
      <span data-wcs="textContent: msg">test</span>
    `);

    await hydrate(ssrHtml);

    // data-wcs-completed はハイドレーション中の重複登録防止用の一時マーカーで、
    // 完了後に除去される（state 側 ssr.hydrate.bindings.test.ts と同じ契約）
    expect(document.querySelectorAll('[data-wcs-completed]').length).toBe(0);

    // ハイドレーション済みバインディングが機能すること
    const stateEl = document.querySelector('wcs-state') as any;
    stateEl.createState('writable', (state: any) => {
      state.msg = 'hydrated!';
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(document.querySelector('span')!.textContent).toBe('hydrated!');
  });
});

import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { renderToString } from '../src/render';

function parseResult(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}

describe('属性で代替可能なプロパティ', () => {
  it('input value が value 属性として出力される', async () => {
    const result = await renderToString(`
      <wcs-state json='{"name":"Alice"}'></wcs-state>
      <input data-wcs="value: name" />
    `);
    const doc = parseResult(result);
    const input = doc.querySelector('input');
    expect(input?.getAttribute('value')).toBe('Alice');
  });

  it('checkbox checked が checked 属性として出力される', async () => {
    const result = await renderToString(`
      <wcs-state json='{"agreed":true}'></wcs-state>
      <input type="checkbox" data-wcs="checked: agreed" />
    `);
    const doc = parseResult(result);
    const input = doc.querySelector('input');
    expect(input?.hasAttribute('checked')).toBe(true);
  });

  it('checkbox checked=false は checked 属性なし', async () => {
    const result = await renderToString(`
      <wcs-state json='{"agreed":false}'></wcs-state>
      <input type="checkbox" data-wcs="checked: agreed" />
    `);
    const doc = parseResult(result);
    const input = doc.querySelector('input');
    expect(input?.hasAttribute('checked')).toBe(false);
  });

  it('select selectedIndex が selected 属性として出力される', async () => {
    const result = await renderToString(`
      <wcs-state json='{"idx":2}'></wcs-state>
      <select data-wcs="selectedIndex: idx">
        <option>A</option>
        <option>B</option>
        <option>C</option>
      </select>
    `);
    const doc = parseResult(result);
    const options = doc.querySelectorAll('option');
    expect(options[0].hasAttribute('selected')).toBe(false);
    expect(options[1].hasAttribute('selected')).toBe(false);
    expect(options[2].hasAttribute('selected')).toBe(true);
  });

  it('textarea value がテキストコンテンツとして出力される', async () => {
    const result = await renderToString(`
      <wcs-state json='{"content":"Hello World"}'></wcs-state>
      <textarea data-wcs="value: content"></textarea>
    `);
    const doc = parseResult(result);
    const textarea = doc.querySelector('textarea');
    expect(textarea?.textContent).toBe('Hello World');
  });

  it('disabled が disabled 属性として出力される', async () => {
    const result = await renderToString(`
      <wcs-state json='{"isDisabled":true}'></wcs-state>
      <button data-wcs="disabled: isDisabled">Click</button>
    `);
    const doc = parseResult(result);
    const button = doc.querySelector('button');
    expect(button?.hasAttribute('disabled')).toBe(true);
  });
});


// 3.x は属性で表せないプロパティ（innerHTML など）を、要素の data-wcs-ssr-id と <wcs-ssr> の
// script[data-wcs-ssr-props] の値の表に入れ、クライアントがそれを戻していた。4.0 には値の表が無い:
// サーバの HTML には描いた結果がそのまま入り、クライアントは引き取ったノードに全バインディングを当て直す
// （@wcstack/state の src/ssr/ssr.ts「Not carried over」）。
describe('属性で代替不可なプロパティ（4.0: 値の表は無い）', () => {
  it('innerHTML の値はサーバの HTML に描かれ、値の表（data-wcs-ssr-id / props）は出ない', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"html":"<b>bold</b>"}'></wcs-state>
      <div data-wcs="innerHTML: html"></div>
    `);
    const doc = parseResult(result);
    expect(doc.querySelector('div[data-wcs="innerHTML: html"]')?.innerHTML).toBe('<b>bold</b>');
    expect(doc.querySelector('[data-wcs-ssr-id]')).toBeNull();
    expect(doc.querySelector('wcs-ssr script[data-wcs-ssr-props]')).toBeNull();
  });

  it('value / checked は属性に入り、値の表は出ない', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"name":"Alice","agreed":true}'></wcs-state>
      <input data-wcs="value: name" />
      <input type="checkbox" data-wcs="checked: agreed" />
    `);
    const doc = parseResult(result);
    expect(doc.querySelector('input[data-wcs="value: name"]')?.getAttribute('value')).toBe('Alice');
    expect(doc.querySelector('input[data-wcs="checked: agreed"]')?.hasAttribute('checked')).toBe(true);
    expect(doc.querySelector('wcs-ssr script[data-wcs-ssr-props]')).toBeNull();
  });
});

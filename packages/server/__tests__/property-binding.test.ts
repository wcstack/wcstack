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

describe('属性で代替不可なプロパティ（ハイドレーション用データ）', () => {
  it('innerHTML が wcs-ssr 内に格納される', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"html":"<b>bold</b>"}'></wcs-state>
      <div data-wcs="innerHTML: html"></div>
    `);
    const doc = parseResult(result);

    // 要素に data-wcs-ssr-id が振られている
    const el = doc.querySelector('div[data-wcs-ssr-id]');
    const ssrId = el?.getAttribute('data-wcs-ssr-id');
    expect(ssrId).toBeTruthy();

    // <wcs-ssr> 内の props script にデータがある
    const propsScript = doc.querySelector('wcs-ssr script[data-wcs-ssr-props]');
    expect(propsScript).not.toBeNull();
    const propsData = JSON.parse(propsScript?.textContent ?? '{}');
    expect(propsData[ssrId!]).toBeDefined();
    expect(propsData[ssrId!].innerHTML).toBe('<b>bold</b>');
  });

  it('value/checked 等の既知プロパティは props に含まれない', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"name":"Alice","agreed":true}'></wcs-state>
      <input data-wcs="value: name" />
      <input type="checkbox" data-wcs="checked: agreed" />
    `);
    const doc = parseResult(result);

    // 属性に反映されている
    const input = doc.querySelector('input[data-wcs="value: name"]');
    expect(input?.getAttribute('value')).toBe('Alice');

    // props スクリプトに value/checked は含まれない（属性化済み）
    const propsScript = doc.querySelector('wcs-ssr script[data-wcs-ssr-props]');
    if (propsScript) {
      const propsData = JSON.parse(propsScript.textContent ?? '{}');
      for (const id of Object.keys(propsData)) {
        expect(propsData[id].value).toBeUndefined();
        expect(propsData[id].checked).toBeUndefined();
      }
    }
  });
});

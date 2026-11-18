import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { renderToString } from '../src/render';
import { setInnerHTML } from '../src/setInnerHTML';

/**
 * 表の中の <template>（seam app lending-desk）。happy-dom のパーサは <tbody> / <tr> などの直下の <template> を
 * 表の前へ追い出し、中身の行を表に残すので、行の束縛（`.name`）が囲む for を失って renderToString が投げていた。
 * ブラウザ（Chromium・Firefox・WebKit）はそこに <template> を置く。
 */

/** 出力をブラウザのように読む（happy-dom の innerHTML では <wcs-ssr> の中の行のテンプレートが崩れる） */
function parse(html: string): Document {
  const window = new Window();
  const document = window.document as unknown as Document;
  setInnerHTML(document.body, html);
  return document;
}

const texts = (nodes: Iterable<Element>): (string | null)[] => Array.from(nodes, (el) => el.textContent);

describe('renderToString: 表の中の <template>', () => {
  it('<tbody> の for: 行とセルを <tbody> の中に描き、テンプレートは <wcs-ssr> に、アンカーは <tbody> に置く', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"rows":[{"name":"Alice","age":30},{"name":"Bob","age":40}]}'></wcs-state>
      <table><tbody><template data-wcs="for: rows"><tr><td data-wcs="textContent: .name"></td><td data-wcs="textContent: .age"></td></tr></template></tbody></table>
    `);
    expect(result).toContain('<table><tbody><!--wcs-p:wcs-t0--><!--wcs-[--><!--wcs-|--><tr><td>Alice</td><td>30</td></tr><!--wcs-|--><tr><td>Bob</td><td>40</td></tr><!--wcs-]--></tbody></table>');
    const doc = parse(result);
    expect(texts(doc.querySelectorAll('tbody > tr'))).toEqual(['Alice30', 'Bob40']);
    const template = doc.querySelector('wcs-ssr > template') as HTMLTemplateElement;
    expect(template.getAttribute('data-wcs')).toBe('for: rows');
    expect(template.content.firstElementChild?.localName).toBe('tr');
  });

  it('<tr> の中のセルの for: セルを行の中に描く', async () => {
    const result = await renderToString(`
      <wcs-state json='{"cells":["a","b","c"]}'></wcs-state>
      <table><tbody><tr><th>head</th><template data-wcs="for: cells"><td data-wcs="textContent: ."></td></template></tr></tbody></table>
    `);
    const doc = parse(result);
    expect(texts(doc.querySelectorAll('tbody > tr > td'))).toEqual(['a', 'b', 'c']);
    expect(doc.querySelector('tbody > tr > th')?.textContent).toBe('head');
  });

  it('<tbody> の if: 真なら行を <tbody> の中に描き、偽なら描かない', async () => {
    const page = (show: boolean) => `
      <wcs-state json='{"show":${show}}'></wcs-state>
      <table><tbody><tr><td>first</td></tr><template data-wcs="if: show"><tr class="extra"><td>shown</td></tr></template></tbody></table>
    `;
    const shown = parse(await renderToString(page(true)));
    expect(texts(shown.querySelectorAll('tbody > tr'))).toEqual(['first', 'shown']);
    const hidden = parse(await renderToString(page(false)));
    expect(texts(hidden.querySelectorAll('tbody > tr'))).toEqual(['first']);
  });

  it('表の中の入れ子の for: 行の中のセルの for も描く（<thead> と <tfoot> も）', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"heads":["x","y"],"rows":[{"cells":[1,2]},{"cells":[3,4]}],"total":10}'></wcs-state>
      <table>
        <thead><tr><template data-wcs="for: heads"><th data-wcs="textContent: ."></th></template></tr></thead>
        <tbody><template data-wcs="for: rows"><tr><template data-wcs="for: .cells"><td data-wcs="textContent: ."></td></template></tr></template></tbody>
        <tfoot><template data-wcs="if: total"><tr><td data-wcs="textContent: total"></td></tr></template></tfoot>
      </table>
    `);
    const doc = parse(result);
    expect(texts(doc.querySelectorAll('thead th'))).toEqual(['x', 'y']);
    expect(texts(doc.querySelectorAll('tbody > tr'))).toEqual(['12', '34']);
    expect(texts(doc.querySelectorAll('tfoot td'))).toEqual(['10']);
  });

  it('表の無いページの出力は変わらない', async () => {
    const result = await renderToString(
      `<wcs-state json='{"rows":[{"name":"a"},{"name":"b"}],"show":true}'></wcs-state>` +
      `<ul><template data-wcs="for: rows"><li data-wcs="textContent: .name"></li></template></ul>` +
      `<template data-wcs="if: show"><p>x</p></template>`,
    );
    expect(result).toBe(
      `<wcs-state json="{&quot;rows&quot;:[{&quot;name&quot;:&quot;a&quot;},{&quot;name&quot;:&quot;b&quot;}],&quot;show&quot;:true}"></wcs-state>` +
      `<ul><li>a</li><li>b</li><!--wcs-for--></ul><p>x</p><!--wcs-if-->`,
    );
  });
});

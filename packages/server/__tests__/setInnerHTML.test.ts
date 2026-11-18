import { describe, it, expect, afterAll } from 'vitest';
import { Window } from 'happy-dom';
import { setInnerHTML } from '../src/setInnerHTML';

const window = new Window();
const document = window.document as unknown as Document;

afterAll(async () => {
  await window.happyDOM.close();
});

/** happy-dom の innerHTML そのもの */
function plain(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.innerHTML;
}

/** setInnerHTML を通したもの */
function fixed(html: string): string {
  const div = document.createElement('div');
  setInnerHTML(div, html);
  return div.innerHTML;
}

/** innerHTML に渡された文字列を記録する target */
function recorder(): { target: Element; seen: string[] } {
  const seen: string[] = [];
  const target = { set innerHTML(value: string) { seen.push(value); } } as unknown as Element;
  return { target, seen };
}

describe('setInnerHTML: 表の中の <template>', () => {
  it('前提: happy-dom の innerHTML は <tbody> の中の <template> を表の前へ追い出し、中身を表に残す', () => {
    expect(plain('<table><tbody><template data-wcs="for: rows"><tr><td>x</td></tr></template></tbody></table>'))
      .toBe('<template data-wcs="for: rows"></template><table><tbody><tr><td>x</td></tr></tbody></table>');
  });

  it.each([
    ['tbody の for', '<table><tbody><template data-wcs="for: rows"><tr><td data-wcs="textContent: .name"></td></tr></template></tbody></table>'],
    ['table 直下の for', '<table><template data-wcs="for: rows"><tr><td>x</td></tr></template></table>'],
    ['thead の for', '<table><thead><template data-wcs="for: heads"><tr><th>x</th></tr></template></thead></table>'],
    ['tfoot の for', '<table><tfoot><template data-wcs="for: sums"><tr><td>x</td></tr></template></tfoot></table>'],
    ['tr の中のセルの for', '<table><tbody><tr><template data-wcs="for: cells"><td data-wcs="textContent: ."></td></template></tr></tbody></table>'],
    ['colgroup の col の for', '<table><colgroup><template data-wcs="for: cols"><col></template></colgroup></table>'],
    ['tbody の if', '<table><tbody><template data-wcs="if: show"><tr><td>x</td></tr></template></tbody></table>'],
    ['表の中の入れ子の for', '<table><tbody><template data-wcs="for: rows"><tr><template data-wcs="for: .cells"><td data-wcs="textContent: ."></td></template></tr></template></tbody></table>'],
    ['行の中の if の中の for', '<table><tbody><template data-wcs="for: rows"><template data-wcs="if: .open"><tr><template data-wcs="for: .cells"><td>x</td></template></tr></template></template></tbody></table>'],
    ['空の if', '<table><tbody><template data-wcs="if: show"></template><tr><td>a</td></tr></tbody></table>'],
    ['td の中の if', '<table><tbody><tr><td><template data-wcs="if: x"><span>y</span></template></td></tr></tbody></table>'],
    ['表の外で行を持つ template', '<div><template data-wcs="for: rows"><tr><td>x</td></tr></template></div>'],
    ['template の中の表', '<template data-wcs="if: show"><table><tbody><template data-wcs="for: rows"><tr><td>x</td></tr></template></tbody></table></template>'],
  ])('%s: ブラウザと同じく書いた所に置き、中身を content に入れる', (_name, html) => {
    expect(fixed(html)).toBe(html);
  });

  it('置き直した template の中身は content にあり、表の行は content の最上位にある', () => {
    const div = document.createElement('div');
    setInnerHTML(div, '<table><tbody><template data-wcs="for: rows"><tr><td>x</td></tr></template></tbody></table>');
    const template = div.querySelector('tbody > template') as HTMLTemplateElement;
    expect(template).not.toBeNull();
    expect(template.childNodes.length).toBe(0);
    expect(template.content.firstChild?.nodeName).toBe('TR');
    expect(div.querySelectorAll('tr').length).toBe(0);
  });

  it('開始タグの属性は happy-dom が読むとおり（引用符の中の > や文字参照、引用符の無い値）', () => {
    const html = '<table><tbody><template id=t1 data-wcs = "for: rows" title=\'a > b\' data-x="&amp;&lt;"><tr><td>x</td></tr></template></tbody></table>';
    const div = document.createElement('div');
    setInnerHTML(div, html);
    const template = div.querySelector('template')!;
    expect(template.parentElement?.localName).toBe('tbody');
    expect(template.getAttribute('id')).toBe('t1');
    expect(template.getAttribute('data-wcs')).toBe('for: rows');
    expect(template.getAttribute('title')).toBe('a > b');
    expect(template.getAttribute('data-x')).toBe('&<');
  });

  it('ShadowRoot にも使え、<template> を渡せばその中身を置き換える', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const html = '<table><tbody><template data-wcs="for: rows"><tr><td>x</td></tr></template></tbody></table>';
    setInnerHTML(shadow, html);
    expect(shadow.innerHTML).toBe(html);

    const template = document.createElement('template');
    setInnerHTML(template, html);
    expect(template.innerHTML).toBe(html);
    expect(template.content.querySelector('tbody > template')).not.toBeNull();
  });
});

describe('setInnerHTML: これまでどおりに読む HTML', () => {
  it.each([
    ['表の無いページ', '<wcs-state json=\'{"rows":[]}\'></wcs-state><ul><template data-wcs="for: rows"><li data-wcs="textContent: .name"></li></template></ul><template data-wcs="if: show"><p>x</p></template>'],
    ['表はあるが template は表の外', '<table><tbody><tr><td>a</td></tr></tbody></table><ul><template data-wcs="for: rows"><li>x</li></template></ul>'],
    ['表の無い template だけ', '<template data-wcs="if: a"><template data-wcs="for: b"><span></span></template></template>'],
    ['script の中の <template> と表', '<wcs-state><script type="module">export default { html: "<table><tbody><template><tr></tr></template></tbody></table>" };</script></wcs-state>'],
    ['コメントの中の <template> と表', '<!-- <table><tbody><template data-wcs="for: rows"><tr></tr></template></tbody></table> --><p>x</p>'],
    ['終了タグの無い template', '<table><tbody><template data-wcs="for: rows"><tr><td>x</td></tr></tbody></table>'],
    ['終了タグを省いた表の後の template', '<table><tbody><tr><td>x</table><div><template data-wcs="if: a"><span>y</span></template></div>'],
  ])('%s: innerHTML へ書かれたままの文字列を渡す', (_name, html) => {
    const { target, seen } = recorder();
    setInnerHTML(target, html);
    expect(seen).toEqual([html]);
  });

  it('表の要素を 1 つも含まない HTML は走査もせず、そのまま渡す', () => {
    const { target, seen } = recorder();
    const html = '<p>a < b</p><template><span>x</span></template>';
    setInnerHTML(target, html);
    expect(seen).toEqual([html]);
  });

  it('コメント・doctype・処理命令・壊れたタグ・生のテキストの後でも、表の template を置き直す', () => {
    const tail = '<table><tbody><template data-wcs="for: rows"><tr><td>x</td></tr></template></tbody></table>';
    for (const head of [
      '<!---->', '<!--a-->', '<!-- a --!>', '<!DOCTYPE html>', '<?xml x?>', '</>', '</p x>', '< p', 'a < b', '</tr>',
      '<p title="x">', '<p title=x>', '<p data-a=\'"\'>', '<p data-a = "<template>">', '<style>td{}</style >',
      '<script>"</script x>"</script>', '<textarea><template></textarea>',
    ]) {
      const div = document.createElement('div');
      setInnerHTML(div, head + tail);
      expect(div.querySelector('tbody > template')?.content.querySelector('tr'), head).not.toBeNull();
      expect(div.querySelectorAll('tr').length, head).toBe(0);
    }
  });

  it('happy-dom がコメントの続きと読むところ（<!--> と <!---> の後）は、happy-dom と同じく読む', () => {
    const tail = '<table><tbody><template data-wcs="for: rows"><tr><td>x</td></tr></template></tbody></table>';
    for (const head of ['<!-->', '<!--->']) {
      const { target, seen } = recorder();
      setInnerHTML(target, head + tail);
      expect(seen).toEqual([head + tail]);
    }
  });

  it('閉じていないコメント・生のテキスト・開始タグ・引用符は、終わりまでを読み飛ばす', () => {
    const table = '<table><tbody><template data-wcs="for: rows"><tr><td>x</td></tr></template></tbody></table>';
    for (const tail of ['<!-- open', '<script>open', '<p title="open', '<p', '<!doctype']) {
      expect(fixed(table + tail)).toBe(table + plain(tail));
    }
  });
});

/**
 * `data-wcs-ignore`: ランタイム（state の dom/plan.ts の walkBindings）はその要素も中身も束縛として読まない。
 * lint もその中を報告しない（validateDocument）。
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument';
import { findIgnoredRanges } from '../src/language/htmlParse';
import { WcsDiagnosticCode } from '../src/core/diagnostics';

const STATE = `<wcs-state><script type="module">export default { name: "a" };</script></wcs-state>`;

describe('findIgnoredRanges', () => {
  it('印の付いた要素を、開始タグから対応する終了タグまでの範囲で返すこと（同じ名前の入れ子・void 要素・閉じていない要素）', () => {
    const html = '<div data-wcs-ignore><div>x</div></div><p>y</p><img data-wcs-ignore><section data-wcs-ignore>z';
    const ranges = findIgnoredRanges(html, 'data-wcs');
    expect(ranges.map(([s, e]) => html.slice(s, e))).toEqual([
      '<div data-wcs-ignore><div>x</div></div>',
      '<img data-wcs-ignore>',
      '<section data-wcs-ignore>z',
    ]);
  });

  it('コメントと raw text の中の印は数えず、束縛の属性名に従うこと', () => {
    const html = '<!-- <div data-wcs-ignore> --><script>"<div data-wcs-ignore>"</script><b data-bind-ignore>q</b>';
    expect(findIgnoredRanges(html, 'data-wcs')).toEqual([]);
    expect(findIgnoredRanges(html, 'data-bind').map(([s, e]) => html.slice(s, e))).toEqual(['<b data-bind-ignore>q</b>']);
  });
});

describe('validateDocument — data-wcs-ignore', () => {
  it('印の付いた要素の中（要素自身の data-wcs も）は報告せず、外は報告すること', () => {
    const html = `${STATE}<div data-wcs-ignore data-wcs="textContent: missingA"><p data-wcs="textContent: missingB">x</p></div>`
      + `<p data-wcs="textContent: missingC">y</p>`;
    const missing = validateDocument(html, { locale: 'en' })
      .filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing)
      .map((d) => html.slice(d.start, d.end));
    expect(missing).toEqual(['missingC']);
  });

  it('印の付いた要素の中の {{ }} も報告しないこと', () => {
    const html = `${STATE}<template data-wcs="if: name"><div data-wcs-ignore>{{ nope }}</div></template>`;
    expect(validateDocument(html, { locale: 'en' }).filter((d) => html.slice(d.start, d.end).includes('nope'))).toEqual([]);
  });
});

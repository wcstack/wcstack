/**
 * ioAttributeValidator.test.ts — 組み込みタグのリテラルの属性値で、プラットフォームが拒むもの（継ぎ目アプリ
 * town-archive、4.24）。
 *
 *   - `wcs/root-margin-unit`（warning）— `<wcs-intersect>` / `<wcs-infinite-scroll>` の、px も % も無い `root-margin`。
 *     受ける形は Chromium と Firefox で確かめた: 1〜4 個、それぞれ px か % の付いた数値で、0 にも単位が要る
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { runValidation } from '../src/core/cli/runValidation.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics.js';
import { checkRootMargin } from '../src/service/ioAttributeValidator.js';

const validate = (html: string, locale = 'en', files: Record<string, string> = {}): WcsDiagnostic[] =>
  validateDocument(html, { locale, fileReader: (p: string) => files[p] });
const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const textOf = (html: string, d: WcsDiagnostic): string => html.slice(d.start, d.end);

describe('wcs/root-margin-unit — 単位の無い root-margin', () => {
  const rootMargins = (html: string, locale = 'en'): WcsDiagnostic[] => ofCode(validate(html, locale), WcsDiagnosticCode.RootMarginUnit);

  it('px も % も無い数値のある root-margin を warning で報告し、px を足した書き方を言うこと（0 にも単位が要る）', () => {
    const html = `<wcs-intersect root-margin="200"></wcs-intersect>
<wcs-infinite-scroll target="list" root-margin="0 0 900 0"></wcs-infinite-scroll>
<wcs-intersect root-margin="0 0 900px 0"></wcs-intersect>
<wcs-intersect root-margin='-50 10%'></wcs-intersect>
<wcs-intersect root-margin=300></wcs-intersect>`;
    const found = rootMargins(html);
    expect(found.map((d) => [d.severity, d.tag, textOf(html, d)])).toEqual([
      ['warning', 'wcs-intersect', '200'], ['warning', 'wcs-infinite-scroll', '0 0 900 0'],
      ['warning', 'wcs-intersect', '0 0 900px 0'], ['warning', 'wcs-intersect', '-50 10%'], ['warning', 'wcs-intersect', '300'],
    ]);
    expect(found[0].message).toBe('The browser refuses root-margin="200" (rootMargin must be specified in pixels or percent): "200" is not a number with px or %. So the element observes nothing and observing stays false. Write root-margin="200px"');
    expect(found[1].message).toBe('The browser refuses root-margin="0 0 900 0" (rootMargin must be specified in pixels or percent): "0", "900" are not numbers with px or % (a 0 needs its unit too). So the element observes nothing and no page is loaded. Write root-margin="0px 0px 900px 0px"');
    expect(found[2].message).toContain('"0" is not a number with px or % (a 0 needs its unit too)');
    expect(found[3].message).toContain('Write root-margin="-50px 10%"');
    const ja = rootMargins(html, 'ja');
    expect(ja[0].message).toBe('ブラウザは root-margin="200" を拒みます（rootMargin must be specified in pixels or percent）: "200" は px か % の付いた数値ではありません。そのため要素は何も監視せず、observing は false のままです。root-margin="200px" と書いてください');
    expect(ja[1].message).toContain('"0"・"900" は px か % の付いた数値ではありません（0 にも単位が要ります）。そのため要素は何も監視せず、次のページは読み込まれません');
  });

  it('ほかの単位・5 個以上の値も同じ理由でブラウザが拒むので報告し、書き換えは一般の形で言うこと', () => {
    const html = `<wcs-intersect root-margin="1em 10px"></wcs-intersect>
<wcs-intersect root-margin="1px 2px 3px 4px 5px"></wcs-intersect>
<wcs-intersect root-margin="10px,20px"></wcs-intersect>`;
    const found = rootMargins(html);
    expect(found.map((d) => textOf(html, d))).toEqual(['1em 10px', '1px 2px 3px 4px 5px', '10px,20px']);
    expect(found[0].message).toContain('"1em" is not a number with px or %. So');
    expect(found[0].message).toContain('Write one to four values, each a number with px or %');
    expect(found[1].message).toContain('it takes one to four values');
  });

  it('単位の付いた値・空の値・束ねた rootMargin・サーバーテンプレートの値・ほかのタグの root-margin には出さないこと', () => {
    const html = `<wcs-state><script type="module">export default { margin: "200", seen: false };</script></wcs-state>
<wcs-intersect root-margin="200px"></wcs-intersect>
<wcs-intersect root-margin="0px 0px 900px 0px"></wcs-intersect>
<wcs-intersect root-margin="10% -50px"></wcs-intersect>
<wcs-intersect root-margin=".5px 1e2px 0% +5PX"></wcs-intersect>
<wcs-intersect root-margin=""></wcs-intersect>
<wcs-intersect data-wcs="intersecting: seen"></wcs-intersect>
<wcs-intersect root-margin="200" data-wcs="rootMargin: margin"></wcs-intersect>
<wcs-intersect root-margin="200" data-wcs=".rootMargin#ro: margin; intersecting: seen"></wcs-intersect>
<wcs-infinite-scroll target="list" root-margin="{{ margin }}"></wcs-infinite-scroll>
<wcs-resize root-margin="200"></wcs-resize>
<div root-margin="200" data-root-margin="200"></div>
<!-- <wcs-intersect root-margin="200"></wcs-intersect> -->`;
    expect(rootMargins(html)).toEqual([]);
  });

  it('checkRootMargin: ブラウザが受ける形（1〜4 個、px か % の付いた数値）だけを通すこと', () => {
    for (const ok of ['', ' ', '0px', '200px', '10%', '-50px', '0px 0px 900px 0px', '.5%', '1e2px', '+5px', '10PX', '5px  5px', '\t5px\n']) {
      expect(checkRootMargin(ok), ok).toBeNull();
    }
    expect(checkRootMargin('0')).toEqual({ refused: ['0'], suggested: '0px' });
    expect(checkRootMargin('0 0 900 0')).toEqual({ refused: ['0', '900'], suggested: '0px 0px 900px 0px' });
    expect(checkRootMargin('-50')).toEqual({ refused: ['-50'], suggested: '-50px' });
    expect(checkRootMargin('1em')).toEqual({ refused: ['1em'], suggested: null });
    expect(checkRootMargin('auto')).toEqual({ refused: ['auto'], suggested: null });
    expect(checkRootMargin('10 px')).toEqual({ refused: ['10', 'px'], suggested: null });
    expect(checkRootMargin('calc(1px)')).toEqual({ refused: ['calc(1px)'], suggested: null });
    expect(checkRootMargin('1px 2px 3px 4px 5px')).toEqual({ refused: [], suggested: null });
    expect(checkRootMargin('1 2 3 4 5')).toEqual({ refused: ['1', '2', '3', '4', '5'], suggested: null });
  });

  it('CLI: warning なので既定では exit 0、--strict では exit 1', () => {
    const html = `<wcs-intersect root-margin="200"></wcs-intersect>`;
    const loose = runValidation([{ source: 'page.html', text: html, kind: 'html' }], { locale: 'en' });
    expect(loose.warningCount).toBe(1);
    expect(loose.exitCode).toBe(0);
    expect(runValidation([{ source: 'page.html', text: html, kind: 'html' }], { strict: true, locale: 'en' }).exitCode).toBe(1);
  });
});

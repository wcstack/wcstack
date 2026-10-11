/**
 * nonAsciiOffsets.test.ts — 小文字にすると文字数が変わる文字（`İ` U+0130 など）があっても、位置がずれないこと。
 *
 * HTML のタグ名・終了タグの検索は ASCII case-insensitive。`String#toLowerCase` は `İ` を 2 文字
 * （`i` ＋ U+0307）にするので、その結果の上で探した位置を元の文字列に当てると、それより後ろがずれていた
 * （`<p>İSTANBUL İZMİR</p>` の後ろのスクリプトの終わりを 3 文字取り違え、`nope` の未存在パスを見落とした）。
 */
import { describe, it, expect } from 'vitest';
import { asciiLowerCase, createTemplateTester, findStartTagRegions, parseWcsScriptBlocks, parseWcsStateElements } from '../src/language/htmlParse';
import { findAllCommentBindings, findAllMustacheSyntax } from '../src/service/templateSyntax';
import { isRowOrBranchContent } from '../src/service/forContext';
import { validateDocument } from '../src/core/validateDocument';
import { WcsDiagnosticCode } from '../src/core/diagnostics';

const TURKISH = '<p>İSTANBUL İZMİR</p>\n';

describe('asciiLowerCase', () => {
  it('ASCII の英大文字だけを小文字にし、文字数を変えない', () => {
    // İ（U+0130）・ſ（U+017F）・K（U+212A ケルビン記号）は ASCII ではないのでそのまま
    expect(asciiLowerCase('<SCRIPT Type="MODULE">İSTANBUL ſ K K</SCRIPT>')).toBe('<script type="module">İstanbul ſ K k</script>');
    expect(asciiLowerCase(TURKISH)).toHaveLength(TURKISH.length);
    expect(TURKISH.toLowerCase()).not.toHaveLength(TURKISH.length); // 前提: toLowerCase は文字数を変える
  });
});

describe('İ の後ろでも位置がずれない', () => {
  const script = 'export default { count: 1 };';
  const html = `${TURKISH}<wcs-state><script type="module">${script}</script></wcs-state>\n<p data-wcs="textContent: nope"></p>`;

  it('<wcs-state> のスクリプトの範囲（指摘者の t18.html）', () => {
    const [block] = parseWcsScriptBlocks(html);
    expect(block.content).toBe(script);
    expect(html.slice(block.contentStart, block.contentEnd)).toBe(script);
    const [element] = parseWcsStateElements(html);
    expect(html.slice(element.tagStart, element.tagEnd)).toBe('<wcs-state>');
  });

  it('存在しないパスを見落とさない（validateDocument）', () => {
    const missing = validateDocument(html, { locale: 'en' }).filter(d => d.code === WcsDiagnosticCode.BindingPathMissing);
    expect(missing.map(d => html.slice(d.start, d.end))).toEqual(['nope']);
  });

  it('raw text の終わり（開始タグの走査・mustache / コメント束縛の走査・#203 の要素の積み上げ）', () => {
    const doc = `${TURKISH}<script>const s = "İİİ {{ inScript }}";</script><p>{{ after }}</p><!--@@: comment-->`;
    expect(findStartTagRegions(doc).map(r => r.tagName)).toEqual(['p', 'script', 'p']);
    expect(findAllMustacheSyntax(doc).map(m => m.expression)).toEqual(['after']);
    expect(findAllCommentBindings(doc).map(m => doc.slice(m.exprStart, m.exprEnd))).toEqual(['comment']);

    const rows = `${TURKISH}<textarea>İİİ</textarea><template data-wcs="for: items"><div data-wcs="outerHTML: h"></div></template>`;
    expect(isRowOrBranchContent(rows, rows.indexOf('outerHTML'))).toBe(true);
  });

  it('<template> の中かどうか（root の判定）', () => {
    const doc = `${TURKISH}<script>"İİİİ"</script><template><wcs-state></wcs-state></template><wcs-state></wcs-state>`;
    const inside = createTemplateTester(doc);
    expect(inside(doc.indexOf('<wcs-state>'))).toBe(true);
    expect(inside(doc.lastIndexOf('<wcs-state>'))).toBe(false);
  });
});

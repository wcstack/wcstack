import { describe, it, expect } from 'vitest';
import {
  isInsideForTemplate, getResolvedForListPath, rankOfForList, listsPerLevel, wildcardPrefixes, findOtherListWildcard, isRowOrBranchContent,
} from '../src/service/forContext';

describe('isInsideForTemplate', () => {
  it('for テンプレート内は true', () => {
    const html = '<template data-wcs="for: users"><span data-wcs="textContent: .name"></span></template>';
    const spanPos = html.indexOf('<span');
    expect(isInsideForTemplate(html, spanPos)).toBe(true);
  });

  it('for テンプレート外は false', () => {
    const html = '<div data-wcs="textContent: count"></div><template data-wcs="for: users"></template>';
    const divPos = html.indexOf('<div');
    expect(isInsideForTemplate(html, divPos)).toBe(false);
  });

  it('for テンプレートの後は false', () => {
    const html = '<template data-wcs="for: users"><span></span></template><div data-wcs="textContent: count"></div>';
    const divPos = html.indexOf('<div');
    expect(isInsideForTemplate(html, divPos)).toBe(false);
  });

  it('ネストされた for の内側は true', () => {
    const html = `
<template data-wcs="for: categories">
  <template data-wcs="for: .products">
    <span data-wcs="textContent: .name"></span>
  </template>
</template>`;
    const spanPos = html.indexOf('<span');
    expect(isInsideForTemplate(html, spanPos)).toBe(true);
  });

  it('if テンプレート内は false', () => {
    const html = '<template data-wcs="if: active"><span></span></template>';
    const spanPos = html.indexOf('<span');
    expect(isInsideForTemplate(html, spanPos)).toBe(false);
  });

  it('for テンプレートなしは false', () => {
    const html = '<div data-wcs="textContent: count"></div>';
    expect(isInsideForTemplate(html, 5)).toBe(false);
  });

  it('カスタム属性名に対応', () => {
    const html = '<template data-bind="for: users"><span></span></template>';
    const spanPos = html.indexOf('<span');
    expect(isInsideForTemplate(html, spanPos, 'data-bind')).toBe(true);
    expect(isInsideForTemplate(html, spanPos, 'data-wcs')).toBe(false);
  });
});

describe('段ごとのリスト（4.0 の #1403 — 行の中の別のリストの `*`）', () => {
  it('getResolvedForListPath は相対 for を外側から合成し、rankOfForList はその段数を返す', () => {
    const html = '<template data-wcs="for: groups"><template data-wcs="for: .items"><i></i></template></template>';
    const at = html.indexOf('<i>');
    expect(getResolvedForListPath(html, at)).toBe('groups.*.items');
    expect(rankOfForList('groups.*.items')).toBe(2);
    expect(getResolvedForListPath('<i></i>', 0)).toBeNull();
  });

  it('listsPerLevel / wildcardPrefixes は段ごとのリストを外側から返す', () => {
    expect(listsPerLevel('groups.*.items')).toEqual(['groups', 'groups.*.items']);
    expect(wildcardPrefixes('a.*.b.*.c')).toEqual(['a', 'a.*.b']);
  });

  it('findOtherListWildcard は最初に食い違う段を返し、判定できないときは null', () => {
    expect(findOtherListWildcard('b.*.y', 'a')).toEqual({ over: 'b', loop: 'a' });
    expect(findOtherListWildcard('groups.*.items.*.v', 'groups.*.items')).toBeNull();
    expect(findOtherListWildcard('a.*.items.*.v', 'groups.*.items')).toEqual({ over: 'a', loop: 'groups' });
    // 段数が足りない（#1401 の担当）・最外殻が相対 for（合成できない）は判定しない
    expect(findOtherListWildcard('b.*.c.*.d', 'a')).toBeNull();
    expect(findOtherListWildcard('b.*.y', '.*.items')).toBeNull();
  });

  it('isRowOrBranchContent は for / if / elseif / else の中身だけを数える（開始タグの中・素の template は外）', () => {
    const html = '<template data-wcs="if: ok"><b data-wcs="x: y"></b></template><template><i data-wcs="x: y"></i></template><template data-wcs="else:"><u data-wcs="x: y"></u></template>';
    const at = (tag: string) => html.indexOf(`<${tag} data-wcs="`) + tag.length + 12;
    expect(isRowOrBranchContent(html, at('b'))).toBe(true);
    expect(isRowOrBranchContent(html, at('i'))).toBe(false);
    expect(isRowOrBranchContent(html, at('u'))).toBe(true);
    expect(isRowOrBranchContent(html, html.indexOf('if: ok'))).toBe(false);
  });

  it('isRowOrBranchContent は、ランタイムが読まない場所（行の中の素の template・中身を置き換える束縛の子孫・noscript）を外す', () => {
    const html = `<template data-wcs="for: rows">
<template><s data-wcs="x: y"></s></template>
<div data-wcs="textContent: t"><q data-wcs="x: y"></q></div>
<div data-wcs=".innerHTML#ro: h"><p><a data-wcs="x: y"></a></p></div>
<noscript><em data-wcs="x: y"></em></noscript>
<img src="a.png"><br/><script>"<div data-wcs=\\"textContent: z\\">"</script>
<div data-wcs="title: t"><b data-wcs="x: y"></b></div>
</template>`;
    const at = (tag: string) => html.indexOf(`<${tag} data-wcs="`) + tag.length + 12;
    expect(isRowOrBranchContent(html, at('s'))).toBe(false);
    expect(isRowOrBranchContent(html, at('q'))).toBe(false);
    expect(isRowOrBranchContent(html, at('a'))).toBe(false);
    expect(isRowOrBranchContent(html, at('em'))).toBe(false);
    expect(isRowOrBranchContent(html, at('b'))).toBe(true);
  });

});

describe('isRowOrBranchContent — HTML のパーサとのずれ（K6 の取りこぼし）', () => {
  const at = (html: string, needle: string) => html.indexOf(needle) + needle.length;

  it('構造テンプレートの値の末尾の ; は空の式として数えない（for: rows;）', () => {
    const html = '<template data-wcs="for: rows;"><b data-wcs="outerHTML: h"></b></template>';
    expect(isRowOrBranchContent(html, at(html, '<b data-wcs="'))).toBe(true);
  });

  it('終了タグの省略を暗に閉じる（<li>…<li>・<p>…<div>）', () => {
    const li = '<template data-wcs="for: r"><ul><li data-wcs="textContent: t">x<li><b data-wcs="outerHTML: h"></b></ul></template>';
    expect(isRowOrBranchContent(li, at(li, '<b data-wcs="'))).toBe(true);
    const p = '<template data-wcs="for: r"><p data-wcs="textContent: t">x<div><i data-wcs="outerHTML: h"></i></div></template>';
    expect(isRowOrBranchContent(p, at(p, '<i data-wcs="'))).toBe(true);
    // 要素自身が前の要素を暗に閉じる側（<p>…<div outerHTML>・<option>…<option outerHTML>）
    const selfP = '<template data-wcs="for: a"><p data-wcs="textContent: n">t<div data-wcs="outerHTML: h"></div></template>';
    expect(isRowOrBranchContent(selfP, at(selfP, '<div data-wcs="'))).toBe(true);
    const selfOption = '<template data-wcs="for: a"><select><option data-wcs="textContent: n">a<option data-wcs="outerHTML: h"></select></template>';
    expect(isRowOrBranchContent(selfOption, at(selfOption, 'a<option data-wcs="'))).toBe(true);
    // 対照: 閉じていない <p> の中のインライン要素はその子孫のまま
    const inline = '<template data-wcs="for: r"><p data-wcs="textContent: t">x<span><i data-wcs="outerHTML: h"></i></span></template>';
    expect(isRowOrBranchContent(inline, at(inline, '<i data-wcs="'))).toBe(false);
  });

  it('void でない要素の /> は閉じない（HTML は無視する）。svg / math の中だけ閉じる', () => {
    const custom = '<template data-wcs="for: r"><my-x data-wcs="textContent: n" /><b data-wcs="outerHTML: h"></b></template>';
    expect(isRowOrBranchContent(custom, at(custom, '<b data-wcs="'))).toBe(false);
    const svg = '<template data-wcs="for: r"><svg><g data-wcs="textContent: n"/><text data-wcs="outerHTML: h"></text></svg></template>';
    expect(isRowOrBranchContent(svg, at(svg, '<text data-wcs="'))).toBe(true);
    const voids = '<template data-wcs="for: r"><img src="a" /><br/><b data-wcs="outerHTML: h"></b></template>';
    expect(isRowOrBranchContent(voids, at(voids, '<b data-wcs="'))).toBe(true);
  });

  it('offset が <textarea> / <title> の中なら束縛ではない（ブラウザでは文字）', () => {
    const textarea = '<template data-wcs="for: r"><textarea><b data-wcs="outerHTML: h"></b></textarea></template>';
    expect(isRowOrBranchContent(textarea, at(textarea, '<b data-wcs="'))).toBe(false);
    const title = '<template data-wcs="if: ok"><title><b data-wcs="outerHTML: h"></b></title></template>';
    expect(isRowOrBranchContent(title, at(title, '<b data-wcs="'))).toBe(false);
  });

  it('引用符の無い属性値（data-wcs=for:rows・data-wcs=textContent:t）も読む', () => {
    const html = '<template data-wcs=for:rows><b data-wcs="outerHTML: h"></b><div data-wcs=textContent:t><i data-wcs="outerHTML: h"></i></div></template>';
    expect(isRowOrBranchContent(html, at(html, '<b data-wcs="'))).toBe(true);
    expect(isRowOrBranchContent(html, at(html, '<i data-wcs="'))).toBe(false);
  });
});

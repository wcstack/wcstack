import { describe, it, expect } from 'vitest';
import { validateTemplateSyntax } from '../src/service/templateSyntaxValidator';
import { WcsDiagnosticCode } from '../src/core/diagnostics';

const STATE = `
<wcs-state>
  <script type="module">
export default {
  tags: ["a", "b"],
  regions: [{ name: "n", states: [{ name: "s" }] }],
  total: 0,
};
  </script>
</wcs-state>`;

describe('validateTemplateSyntax — 省略パス `.` の展開', () => {
  it('単独の `{{ . }}` は `<forPath>.*` に展開して警告を出さない', () => {
    const html = `${STATE}
<template data-wcs="for: tags"><li>{{ . }}</li></template>`;
    const diags = validateTemplateSyntax(html, 'wcs-state');
    expect(diags.filter(d => d.code === WcsDiagnosticCode.BindingPathMissing)).toHaveLength(0);
  });

  it('展開先が存在しない `{{ . }}` の warning には末尾区切りなしの展開先を出す', () => {
    const html = `${STATE}
<template data-wcs="for: missingList"><li>{{ . }}</li></template>`;
    const diags = validateTemplateSyntax(html, 'wcs-state');
    expect(diags.some(d => d.message.includes('（展開: missingList.*）'))).toBe(true);
  });
});

describe('validateTemplateSyntax — `path@name`（v2 撤去構文）は検証しない', () => {
  it('`@` 入りの式は strip 受理せず、パス存在の誤報も出さない（error は namedStateValidator が担う）', () => {
    // 旧挙動: `@` 前を strip して受理していた（`missing@cart` → `missing` の
    // BindingPathMissing 誤報・`total@cart` は無診断で沈黙）
    const html = `${STATE}
<template data-wcs="for: tags"><li><!--@@: missing@cart--></li></template>
<p>{{ total@cart }}</p>`;
    const diags = validateTemplateSyntax(html, 'wcs-state');
    expect(diags.filter(d => d.code === WcsDiagnosticCode.BindingPathMissing)).toHaveLength(0);
  });
});

describe('validateTemplateSyntax — 入れ子 <template>', () => {
  const NESTED = `${STATE}
<template data-wcs="for: regions">
  <template data-wcs="for: regions.*.states">
    <span>{{ .name }}</span>
  </template>
  <b>{{ .name }}</b>
</template>`;

  it('内側の </template> の後でも外側の for 内なら FOUC info を出さない', () => {
    const diags = validateTemplateSyntax(NESTED, 'wcs-state');
    expect(diags.filter(d => d.message.includes('FOUC'))).toHaveLength(0);
  });

  it('内側の </template> の後でも外側の for 内なら省略パス warning を出さない', () => {
    const diags = validateTemplateSyntax(NESTED, 'wcs-state');
    expect(diags.filter(d => d.message.includes('省略パス'))).toHaveLength(0);
  });
});

describe('validateTemplateSyntax — フィルタの旧名（@wcstack/state 3.2・要件 B12）', () => {
  it('旧名は未知扱いせず、wcs/name-alias（info）で正式名を提案する', () => {
    const html = `${STATE}
<p>{{ total | fix(1) }}</p><p>{{ total | toFixed(1) }}</p><p>{{ total | fxi }}</p>`;
    const diags = validateTemplateSyntax(html, 'wcs-state');
    const alias = diags.filter(d => d.code === WcsDiagnosticCode.NameAlias);
    expect(alias).toHaveLength(1);
    expect(alias[0].severity).toBe('info');
    expect(alias[0].message).toContain('"toFixed"');
    expect(html.slice(alias[0].start, alias[0].end)).toBe('fix');
    // 正式名は何も出さず、本当に未知の名前は従来どおり filter-unknown
    expect(diags.filter(d => d.code === WcsDiagnosticCode.FilterUnknown).map(d => html.slice(d.start, d.end))).toEqual(['fxi']);
  });

  // Fixed by review — 区間の開始を `indexOf` で求めていたため、同じフィルタを 2 回書くと
  // 2 件目のレンジも 1 個目の出現を指していた（積算オフセットに変更）。
  it('同じフィルタを 2 回書いても、それぞれのレンジが自分の出現を指すこと', () => {
    const html = `${STATE}
<p>{{ label | uc | uc }}</p>`;
    const alias = validateTemplateSyntax(html, 'wcs-state')
      .filter(d => d.code === WcsDiagnosticCode.NameAlias);
    expect(alias).toHaveLength(2);
    expect(alias.map(d => html.slice(d.start, d.end))).toEqual(['uc', 'uc']);
    expect(alias[0].start).not.toBe(alias[1].start);
    expect(alias[1].start).toBe(html.indexOf('uc', alias[0].start + 1));
  });

  // Fixed by review（サイクル 2）— 式を素の `split("|")` で切っていたため、
  // `{{ items|join('|') }}` の引数が割れて後片（`')`）を未知フィルタと誤報していた。
  it('引用符の中の `|` はフィルタの区切りではないこと（要件 B1）', () => {
    const html = `${STATE}
<p>{{ tags|join('|') }}</p>`;
    expect(validateTemplateSyntax(html, 'wcs-state')
      .filter(d => d.code === WcsDiagnosticCode.FilterUnknown)).toEqual([]);
  });

  it('引用符の外の `|` では切れ、後続の未知フィルタは報告すること（対照）', () => {
    const html = `${STATE}
<p>{{ tags|join('|')|zzz }}</p>`;
    const unknown = validateTemplateSyntax(html, 'wcs-state')
      .filter(d => d.code === WcsDiagnosticCode.FilterUnknown);
    expect(unknown.map(d => html.slice(d.start, d.end))).toEqual(['zzz']);
  });

  it('未知フィルタが 2 回でもレンジが重ならないこと', () => {
    const html = `${STATE}
<p>{{ label | zzz | zzz }}</p>`;
    const unknown = validateTemplateSyntax(html, 'wcs-state')
      .filter(d => d.code === WcsDiagnosticCode.FilterUnknown);
    expect(unknown).toHaveLength(2);
    expect(unknown.map(d => html.slice(d.start, d.end))).toEqual(['zzz', 'zzz']);
    expect(unknown[1].start).toBe(html.indexOf('zzz', unknown[0].start + 1));
  });
});

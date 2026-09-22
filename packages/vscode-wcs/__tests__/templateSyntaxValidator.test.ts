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
});

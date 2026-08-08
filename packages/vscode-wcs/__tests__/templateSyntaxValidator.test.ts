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

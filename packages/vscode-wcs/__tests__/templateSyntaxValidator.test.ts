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

describe('validateTemplateSyntax — 4.0 で外れたフィルタ名（3.x の旧名・substr）', () => {
  it('旧名は wcs/filter-unknown で正式名を案内し、正式名は何も出さない', () => {
    const html = `${STATE}
<p>{{ total | fix(1) }}</p><p>{{ total | toFixed(1) }}</p><p>{{ total | fxi }}</p>`;
    const diags = validateTemplateSyntax(html, 'wcs-state');
    const unknown = diags.filter(d => d.code === WcsDiagnosticCode.FilterUnknown);
    expect(unknown.map(d => html.slice(d.start, d.end))).toEqual(['fix', 'fxi']);
    expect(unknown[0].message).toContain('4.0 で外れました');
    expect(unknown[0].message).toContain('"toFixed"');
    expect(unknown[1].message).toBe('フィルタ "fxi" は組み込みフィルタに存在しません');
    expect(diags.some(d => d.code === WcsDiagnosticCode.NameAlias)).toBe(false);
  });

  it('substr は書き換え先 slice(start, start + length) を案内する（数値リテラルなら具体形も）', () => {
    const html = `${STATE}
<p>{{ total | substr(1, 4) }}</p>`;
    const unknown = validateTemplateSyntax(html, 'wcs-state', 'data-wcs', 'en')
      .filter(d => d.code === WcsDiagnosticCode.FilterUnknown);
    expect(unknown.map(d => html.slice(d.start, d.end))).toEqual(['substr']);
    expect(unknown[0].message).toContain('slice(start, start + length)');
    expect(unknown[0].message).toContain('(here: slice(1, 5))');
  });

  // Fixed by review — 区間の開始を `indexOf` で求めていたため、同じフィルタを 2 回書くと
  // 2 件目のレンジも 1 個目の出現を指していた（積算オフセットに変更）。
  it('同じフィルタを 2 回書いても、それぞれのレンジが自分の出現を指すこと', () => {
    const html = `${STATE}
<p>{{ label | uc | uc }}</p>`;
    const unknown = validateTemplateSyntax(html, 'wcs-state')
      .filter(d => d.code === WcsDiagnosticCode.FilterUnknown);
    expect(unknown).toHaveLength(2);
    expect(unknown.map(d => html.slice(d.start, d.end))).toEqual(['uc', 'uc']);
    expect(unknown[0].start).not.toBe(unknown[1].start);
    expect(unknown[1].start).toBe(html.indexOf('uc', unknown[0].start + 1));
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

describe('validateTemplateSyntax — 数値の添字のパス（4.0 は添字の数によらず追従する — #355・#383）', () => {
  it('{{ }} とコメント束縛の数値の添字のパスは警告せず、打ち間違いだけを報告する', () => {
    const html = `${STATE}
<template data-wcs="for: regions"><p>{{ regions.*.states.0.name }}</p></template>
<p><!--@@: regions.0.states.1.name--></p>
<p><!--@@: regions.0.nmae--></p>`;
    const diags = validateTemplateSyntax(html, 'wcs-state');
    expect(diags.some(d => d.code === WcsDiagnosticCode.TemplateSyntax && d.severity === 'warning')).toBe(false);
    expect(diags.filter(d => d.code === WcsDiagnosticCode.BindingPathMissing).map(d => html.slice(d.start, d.end)))
      .toEqual(['regions.0.nmae']);
  });
});

describe('validateTemplateSyntax — 行の中の別のリストの *（4.0 の #1403）', () => {
  it('for: tags の行の中の {{ regions.*.name }} は warning、自分のリストは通す', () => {
    const html = `${STATE}
<template data-wcs="for: tags"><p>{{ regions.*.name }}</p><p>{{ tags.* }}</p></template>`;
    const rank = validateTemplateSyntax(html, 'wcs-state', 'data-wcs', 'en')
      .filter(d => d.code === WcsDiagnosticCode.WildcardRank);
    expect(rank.map(d => html.slice(d.start, d.end))).toEqual(['regions.*.name']);
    expect(rank[0].message).toContain('ranges over the rows of "regions"');
  });
});

describe('validateTemplateSyntax — コメント束縛（4.0 も束ねる）', () => {
  it('複数行の式も検証し、FOUC の勧めは <template> の外の {{ }} にだけ出す', () => {
    const html = `${STATE}
<p><!--@@:
  total
  | zzz
--></p>
<p>{{
  total
}}</p>`;
    const diags = validateTemplateSyntax(html, 'wcs-state');
    expect(diags.filter(d => d.code === WcsDiagnosticCode.FilterUnknown).map(d => html.slice(d.start, d.end))).toEqual(['zzz']);
    expect(diags.filter(d => d.message.includes('FOUC'))).toHaveLength(1);
  });

  it('<textarea> / <title> の中のコメントは束縛として扱わない（ブラウザは文字にする）', () => {
    const html = `${STATE}
<textarea><!--@@: missing1--></textarea>
<title><!--@@: missing2--></title>
<p><!--@@: missing3--></p>`;
    const missing = validateTemplateSyntax(html, 'wcs-state')
      .filter(d => d.code === WcsDiagnosticCode.BindingPathMissing);
    expect(missing.map(d => html.slice(d.start, d.end))).toEqual(['missing3']);
  });
});

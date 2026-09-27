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

// #355: `{{ }}` / `<!--@@:-->` も属性の束縛と同じ規則（bindingValidator の同名の describe を参照）。
// 数値添字が 1 つのパスは実行時に行として読まれ、行 getter も読める。修正前は binding-path-missing と
// template-syntax（「解決済みパスは使用できません」）が 2 件ずつ出ていた。素のパス（添字が 2 つ以上・
// `*` と混ざる）は要素を辿ってデータの候補と照合する。
describe('validateTemplateSyntax — 数値添字のパス（#355）', () => {
  const ISSUE_STATE = `
<wcs-state><script type="module">
export default {
  items: [{ v: 1 }, { v: 2 }],
  groups: [{ items: [{ v: 1 }] }],
  show: true,
  get "items.*.double"() { return this["items.*.v"] * 2; },
};
</script></wcs-state>`;
  const pathDiags = (html: string) => validateTemplateSyntax(html, 'wcs-state', 'data-wcs', 'en')
    .filter(d => d.severity !== 'info')
    .map(d => [html.slice(d.start, d.end), d.code]);

  it('Issue の再現: {{ items.1.v }} / {{ items.1.double }} は 0 件、{{ groups.0.items.0.v }} は素のパスとして template-syntax の 1 件だけ', () => {
    const html = `${ISSUE_STATE}
<template data-wcs="if: show"><p>{{ items.1.v }}</p><p>{{ items.1.double }}</p><p>{{ groups.0.items.0.v }}</p></template>`;
    // 修正前: 6 件。groups.0.items.0.v は実行時も要素を辿って存在するので binding-path-missing は出さない
    expect(pathDiags(html)).toEqual([
      ['groups.0.items.0.v', WcsDiagnosticCode.TemplateSyntax],
    ]);
  });

  it('数値の for（for: groups.0.items）の行の {{ .v }} は要素を辿って存在扱い、{{ .nope }} は binding-path-missing', () => {
    const html = `${ISSUE_STATE}
<template data-wcs="for: groups.0.items"><p>{{ .v }}</p><p>{{ .nope }}</p></template>`;
    expect(pathDiags(html)).toEqual([['.nope', WcsDiagnosticCode.BindingPathMissing]]);
  });

  it('コメントバインディング <!--@@:items.0.double--> も行として読む', () => {
    const html = `${ISSUE_STATE}
<p><!--@@:items.0.double--></p>`;
    expect(pathDiags(html)).toEqual([]);
  });

  it('存在しない行のメンバー（{{ items.0.nope }}）は binding-path-missing だけ', () => {
    const html = `${ISSUE_STATE}
<template data-wcs="if: show"><p>{{ items.0.nope }}</p></template>`;
    expect(pathDiags(html)).toEqual([['items.0.nope', WcsDiagnosticCode.BindingPathMissing]]);
  });

  it('stateSchema 宣言時: 読み替えた形で解決し、行の下の未宣言メンバーは wcs/path-nonexistent（error）', () => {
    const schema = {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object', properties: { v: { type: 'number' } } } },
      },
    };
    const html = `
<wcs-state src="./state.ts"></wcs-state>
<template data-wcs="if: ok"><p>{{ items.0.v }}</p><p>{{ items.0.nmae }}</p></template>`;
    const diags = validateTemplateSyntax(html, 'wcs-state', 'data-wcs', 'en', undefined, schema)
      .filter(d => d.severity !== 'info');
    // 修正前: items.0.nmae は `0` のまま配列の上で property を探して unknown に倒れ、沈黙していた
    expect(diags.map(d => [html.slice(d.start, d.end), d.code, d.severity])).toEqual([
      ['items.0.nmae', WcsDiagnosticCode.PathNonexistent, 'error'],
    ]);
  });

  it('stateSchema 宣言時: 素のパス（数値の for の行・添字 2 つ）も配列の上の添字を要素の形にして schema を引く', () => {
    const schema = {
      type: 'object',
      properties: {
        groups: { type: 'array', items: { type: 'object', properties: {
          items: { type: 'array', items: { type: 'object', properties: { v: { type: 'number' } } } },
        } } },
      },
    };
    const html = `
<wcs-state src="./state.ts"></wcs-state>
<template data-wcs="for: groups.0.items"><p>{{ .v }}</p><p>{{ .nmae }}</p></template>
<template data-wcs="if: ok"><p>{{ groups.0.items.0.nmae }}</p></template>`;
    const diags = validateTemplateSyntax(html, 'wcs-state', 'data-wcs', 'en', undefined, schema)
      .filter(d => d.severity !== 'info');
    // 修正前: どちらも `0` のまま配列の上で property を探して unknown に倒れ、打ち間違いが無言だった
    expect(diags.map(d => [html.slice(d.start, d.end), d.code])).toEqual([
      ['.nmae', WcsDiagnosticCode.PathNonexistent],
      ['groups.0.items.0.nmae', WcsDiagnosticCode.TemplateSyntax],
      ['groups.0.items.0.nmae', WcsDiagnosticCode.PathNonexistent],
    ]);
  });
});

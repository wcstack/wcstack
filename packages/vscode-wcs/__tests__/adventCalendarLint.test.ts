/**
 * adventCalendarLint.test.ts — 外部の評価: Advent Calendar の連載（wcstack 4.28.0 で確定申告の下書きツールを 25 日で
 * 作る）の制作で当たった問題の記録から（docs/v4-direction-2026-10.md §5.27）。
 *
 *   - 1-3: stateSchema が「分からない」と言う所（行に型の無い一覧の `items: {}`）の下は、schema が無いときと同じに
 *     検査する。schema を置くと、それまで知らせていた `.deductio` が何も言わずに通った
 *   - 1-6: 「もしかして」をトップレベルの getter にも（行のフィールドだけだった）
 *   - 2-2: getter が一覧を行のオブジェクトから読み（`this.incomes.reduce((t, row) => t + row.amount, 0)`）、
 *     ページがその行の項目を書く（`<input data-wcs="value: .amount">`）— `wcs/getter-untracked-read`
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics.js';
import type { JsonSchemaNode } from '../src/core/sidecar/types.js';

const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const textOf = (html: string, d: WcsDiagnostic): string => html.slice(d.start, d.end);
const state = (body: string): string => `<wcs-state><script type="module">
export default { ${body} };
</script></wcs-state>
`;

describe('1-3 schema が「分からない」所の下は、schema が無いときと同じに検査する', () => {
  // 連載の 22 日目の形: 空の配列で始まり、行は追加のメソッドのリテラルが作る。wcs-schema は items: {} を書く
  const DEPENDENTS = state(`
  dependents: [],
  get "dependents.*.deduction"() { return this[".income"] > 0 ? 0 : 380000; },
  addDependent() { this.dependents = this.dependents.concat({ kind: "general", income: 0, draft: "" }); },
`);
  const ROWS = `<template data-wcs="for: dependents">
  <span data-wcs="textContent: .deduction|locale"></span>
  <span data-wcs="textContent: .deductio|locale"></span>
  <span>{{ .incom }}</span>
</template>`;
  const schema: JsonSchemaNode = {
    type: 'object',
    properties: { dependents: { type: 'array', items: {} } },
    required: ['dependents'],
  };

  it('schema が無いとき（対照）: 行の綴り違いは warning で、近い名前を言う', () => {
    const html = DEPENDENTS + ROWS;
    const found = ofCode(validateDocument(html, { locale: 'en' }), WcsDiagnosticCode.BindingPathMissing);
    expect(found.map((d) => textOf(html, d))).toEqual(['.deductio', '.incom']);
  });

  it('items: {} の schema があっても同じ warning（以前は 0 件）。data-wcs と {{ }} の両方', () => {
    const html = DEPENDENTS + ROWS;
    const diags = validateDocument(html, { locale: 'en', applicationSchema: schema });
    const found = ofCode(diags, WcsDiagnosticCode.BindingPathMissing);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['warning', '.deductio'], ['warning', '.incom']]);
    expect(found[0].message).toContain('Did you mean "deduction"?');
    expect(found[1].message).toContain('Did you mean "income"?');
    expect(ofCode(diags, WcsDiagnosticCode.PathNonexistent)).toEqual([]);
  });

  it('schema が型を持つ所は従来どおり schema が決める（error）', () => {
    const typed: JsonSchemaNode = {
      type: 'object',
      properties: {
        dependents: {
          type: 'array',
          items: { type: 'object', properties: { kind: { type: 'string' }, income: { type: 'number' }, draft: { type: 'string' }, deduction: { type: 'number' } } },
        },
      },
    };
    const html = DEPENDENTS + ROWS;
    const found = ofCode(validateDocument(html, { locale: 'en', applicationSchema: typed }), WcsDiagnosticCode.PathNonexistent);
    expect(found.map((d) => textOf(html, d))).toEqual(['.deductio', '.incom']);
  });

  it('スコープが開いたパス（spread）は schema が無いときと同じく沈黙する', () => {
    const html = `<wcs-state><script type="module">
const extra = load();
export default { rows: [], ...extra };
</script></wcs-state>
<template data-wcs="for: rows"><span data-wcs="textContent: .whatever"></span></template>
<p data-wcs="textContent: fromSpread.x"></p>`;
    const open: JsonSchemaNode = { type: 'object', properties: { rows: { type: 'array', items: {} } } };
    const without = ofCode(validateDocument(html, { locale: 'en' }), WcsDiagnosticCode.BindingPathMissing).map((d) => textOf(html, d));
    const withSchema = ofCode(validateDocument(html, { locale: 'en', applicationSchema: open }), WcsDiagnosticCode.BindingPathMissing).map((d) => textOf(html, d));
    expect(withSchema).toEqual(without);
  });
});

describe('1-6 トップレベルの getter の綴り違いにも「もしかして」', () => {
  const html = state(`incomes: [], get dependentsDeduction() { return 0; },`)
    + `<p data-wcs="textContent: dependentsDeductio|locale"></p>`;

  it('schema が無いとき（warning）', () => {
    const [found] = ofCode(validateDocument(html, { locale: 'ja' }), WcsDiagnosticCode.BindingPathMissing);
    expect(found.message).toContain('もしかして: "dependentsDeduction"');
  });

  it('schema があるとき（error）', () => {
    const schema: JsonSchemaNode = { type: 'object', properties: { incomes: { type: 'array', items: {} }, dependentsDeduction: { type: 'number' } } };
    const [found] = ofCode(validateDocument(html, { locale: 'en', applicationSchema: schema }), WcsDiagnosticCode.PathNonexistent);
    expect(found.message).toContain('Did you mean "dependentsDeduction"?');
  });
});

describe('2-2 getter が一覧を行のオブジェクトから読み、ページがその行の項目を書く（wcs/getter-untracked-read）', () => {
  const ofRule = (html: string, locale = 'en'): WcsDiagnostic[] =>
    ofCode(validateDocument(html, { locale }), WcsDiagnosticCode.GetterUntrackedRead);

  it('連載の 5 日目の形: reduce の合計と、行の中の書き戻す束縛 → error（$getAll の直し方を言う）', () => {
    const html = state(`
  incomes: [{ label: "売上", amount: 100 }],
  get incomeTotal() { return this.incomes.reduce((total, row) => total + row.amount, 0); },
`) + `<template data-wcs="for: incomes"><input type="number" data-wcs="valueAsNumber: .amount"></template>
<p data-wcs="textContent: incomeTotal"></p>`;
    const found = ofRule(html);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['error', 'row.amount']]);
    expect(found[0].message).toContain('the binding "valueAsNumber: .amount" on <input> writes "incomes.*.amount"');
    expect(found[0].message).toContain('this.$getAll("incomes.*.amount", [])');
    const [ja] = ofRule(html, 'ja');
    expect(ja.message).toContain('行のオブジェクトから項目を読んでいます');
  });

  it('street-reports の形: filter の数と、行の中の checkbox → error。filter の後の reduce・分割代入・for…of も', () => {
    const html = state(`
  todos: [{ title: "a", done: false, cost: 1 }],
  get remaining() { return this.todos.filter((t) => !t.done).length; },
  get doneCost() { return this.todos.filter((t) => t.done).reduce((sum, { cost }) => sum + cost, 0); },
  get titles() { let s = ""; for (const t of this.todos) s += t.title; return s; },
`) + `<template data-wcs="for: todos">
  <input type="checkbox" data-wcs="checked: .done"><input data-wcs="value: .title"><input type="number" data-wcs="valueAsNumber: .cost">
</template>`;
    expect(ofRule(html).map((d) => [d.severity, textOf(html, d)])).toEqual([
      ['error', 't.done'],
      ['error', 't.done'],
      ['error', 'cost'],
      ['error', 't.title'],
    ]);
  });

  it('ページが自分で定義した要素の出力（連載の <yen-input>）やスクリプトの書き込みは warning', () => {
    const html = state(`
  incomes: [{ amount: 100 }],
  get total() { return this.incomes.reduce((t, row) => t + row.amount, 0); },
  get count() { return this.incomes.filter((row) => row.flag).length; },
  mark(i) { this[\`incomes.\${i}.flag\`] = true; },
`) + `<template data-wcs="for: incomes"><yen-input data-wcs="value: .amount"></yen-input></template>`;
    expect(ofRule(html).map((d) => [d.severity, textOf(html, d)])).toEqual([['warning', 'row.amount'], ['warning', 'row.flag']]);
  });

  it('証拠の無い項目・$getAll・一覧そのものの長さ・行を書くだけのメソッドは報告しない', () => {
    const html = state(`
  incomes: [{ label: "a", amount: 100 }],
  get total() { return this.incomes.reduce((t, row) => t + row.amount, 0); },
  get byPath() { return this.$getAll("incomes.*.amount", []).reduce((t, a) => t + a, 0); },
  get size() { return this.incomes.length; },
  get labels() { return this.incomes.map(function (row) { return this.x + row.label; }).join(); },
`) + `<template data-wcs="for: incomes"><input data-wcs="value: .label"></template>`;
    // .label is written, but total reads amount; labels' callback is a function, so its row is still followed — label is written
    expect(ofRule(html).map((d) => textOf(html, d))).toEqual(['row.label']);
  });

  it('#ro の束縛と、書き戻さない要素（<option> の value）は証拠にならない（examples の state-cross-tab-todo・music-room）', () => {
    const html = state(`
  todos: [{ id: "a", text: "x", done: false }],
  get remaining() { return this.todos.filter((t) => !t.done).length; },
  get ready() { return this.todos.some((t) => t.id === "a"); },
  toggle(e) { this.todos = this.todos.map((t) => ({ ...t, done: !t.done })); },
`) + `<template data-wcs="for: todos">
  <input type="checkbox" data-wcs="checked#ro: .done; onchange: toggle">
  <select><option data-wcs="value: .id; textContent: .text"></option></select>
</template>`;
    expect(ofRule(html)).toEqual([]);
  });

  it('一覧を丸ごと置き換えるだけのページ（行の項目を書く証拠が無い）は報告しない', () => {
    const html = state(`
  incomes: [{ amount: 100 }],
  get total() { return this.incomes.reduce((t, row) => t + row.amount, 0); },
  bump(i) { this.incomes = this.incomes.with(i, { amount: 1 }); },
`) + `<template data-wcs="for: incomes"><span data-wcs="textContent: .amount"></span></template>`;
    expect(ofRule(html)).toEqual([]);
  });
});

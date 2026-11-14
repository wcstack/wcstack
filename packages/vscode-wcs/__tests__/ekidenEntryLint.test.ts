/**
 * ekidenEntryLint.test.ts — 継ぎ目アプリ ekiden-entry（入力の重い申し込みウィザード: IME・オートフィル・行の中の入力・
 * フォーム連携のカスタム要素）で見つかった lint の穴（4.23）のうち、state の読み方と `attr.*` の 2 つ。
 *
 *   - L1: 読めない値のメンバー（`team: init.team`）・その場の呼び出し（`errs: emptyErrs()`）を種にしたキーの下を
 *     「存在しない」と言わない（`wcs/path-dynamic-unknown` の info をキーに 1 回。作者のページでは偽の
 *     `wcs/binding-path-missing` が 91 件）
 *   - L5: `attr.*` に boolean を束ねたときの文面（`attr.aria-*` は黙る・論理属性は「"false" でも効く」・ほかは
 *     「文字の "true" / "false"」）
 *
 * フォームの入力の 3 つの規則（L2〜L4）は formInputValidator.test.ts。
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { runValidation } from '../src/core/cli/runValidation.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics.js';
import { analyzeStatePaths } from '../src/service/stateAnalyzer.js';

const validate = (html: string, locale = 'en', files: Record<string, string> = {}): WcsDiagnostic[] =>
  validateDocument(html, { locale, fileReader: (p: string) => files[p] });
const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const textOf = (html: string, d: WcsDiagnostic): string => html.slice(d.start, d.end);
const page = (script: string, body: string): string => `<wcs-state><script type="module">
${script}
</script></wcs-state>
${body}`;
/** 存在の検査と lint の限界の告知だけ（この 2 つの入れ替わりを見る）。 */
const pathFindings = (html: string, files: Record<string, string> = {}): [string, string, string][] =>
  validate(html, 'en', files)
    .filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing || d.code === WcsDiagnosticCode.PathDynamicUnknown)
    .map((d) => [d.code, d.severity, textOf(html, d)]);
const opaqueOf = (script: string, files: Record<string, string> = {}): Record<string, unknown> =>
  Object.fromEntries(analyzeStatePaths(script, { fileReader: (p: string) => files[p], path: '' })
    .filter((p) => p.opaque !== undefined).map((p) => [p.path, p.opaque]));

const SHAPE = `export function emptyEntry() {
  return { team: { name: "", kana: "" }, rep: { phone: "" } };
}
export const DEFAULTS = { team: { name: "", kana: "" }, rows: [{ id: 1, label: "" }] };`;

describe('L1 読めない値を種にしたキー — 下のパスを「存在しない」と言わない', () => {
  it('読めない値のメンバー（team: init.team）の下は黙り、キーに info を 1 回出す（ekiden-entry の形）', () => {
    const html = page(`import { emptyEntry } from "./shape.js";
const init = emptyEntry();
const whole = emptyEntry();
export default { team: init.team, rep: init.rep, whole, flag: false };`, `<input data-wcs="value: team.name">
<input data-wcs="value: rep.phone">
<input data-wcs="value: whole.team.name">
<form><input data-wcs="value: team.kana"></form>`);
    expect(pathFindings(html, { 'shape.js': SHAPE })).toEqual([
      [WcsDiagnosticCode.PathDynamicUnknown, 'info', 'team'],
      [WcsDiagnosticCode.PathDynamicUnknown, 'info', 'rep'],
      [WcsDiagnosticCode.PathDynamicUnknown, 'info', 'whole'],
    ]);
    const [team, rep] = ofCode(validate(html, 'en', { 'shape.js': SHAPE }), WcsDiagnosticCode.PathDynamicUnknown);
    expect(team.message).toBe('The value of "team" (init.team) cannot be read statically, so the 2 paths bound under it are not checked. Give the key a JSDoc @type — its shape, or typeof import("./file.js").name for a module\'s literal (for a dictionary, the default language\'s file, which has every key) — or declare it in the stateSchema of wcstack.manifest.json to have them checked');
    expect(rep.message).toContain('The value of "rep" (init.rep) cannot be read statically, so the path bound under it is not checked');
    const [ja] = ofCode(validate(html, 'ja', { 'shape.js': SHAPE }), WcsDiagnosticCode.PathDynamicUnknown);
    expect(ja.message).toContain('"team" の値（init.team）は静的に読めないので、その下に束ねたパス（2 件）は検査していません');
  });

  it('その場に書いた呼び出し・条件式・new も同じ（import した関数なら、どこから import したかも言う）', () => {
    const html = page(`import { emptyEntry } from "./shape.js";
function emptyErrs() { return { team: { name: "" } }; }
export default { called: emptyEntry(), errs: emptyErrs(), cond: window.x ? { a: 1 } : null, made: new Map() };`,
    `<p data-wcs="textContent: called.team.name"></p>
<p data-wcs="textContent: errs.team.name"></p>
<p data-wcs="textContent: cond.a"></p>
<p data-wcs="textContent: made.size"></p>`);
    const found = ofCode(validate(html, 'en', { 'shape.js': SHAPE }), WcsDiagnosticCode.PathDynamicUnknown);
    expect(found.map((d) => textOf(html, d))).toEqual(['called', 'errs', 'cond', 'made']);
    expect(found[0].message).toContain('The value of "called" (emptyEntry(), imported from "./shape.js") cannot be read statically');
    expect(found[1].message).toContain('The value of "errs" (emptyErrs()) cannot be read statically');
    expect(ofCode(validate(html, 'en', { 'shape.js': SHAPE }), WcsDiagnosticCode.BindingPathMissing)).toEqual([]);
  });

  it('`for:` の行のパス（.id・{{ .label }}）も、キーの下に束ねたパスに数える', () => {
    const html = page(`const init = load();
export default { rows: init.rows };`, `<template data-wcs="for: rows"><span data-wcs="textContent: .id"></span>{{ .label }}</template>`);
    expect(pathFindings(html)).toEqual([[WcsDiagnosticCode.PathDynamicUnknown, 'info', 'rows']]);
    expect(ofCode(validate(html), WcsDiagnosticCode.PathDynamicUnknown)[0].message)
      .toContain('The value of "rows" (init.rows) cannot be read statically, so the 2 paths bound under it are not checked');
  });

  it('ほかの宣言（行の getter・$recursion の行）で分かるパスだけを束ねているなら、何も言わない', () => {
    const getter = page(`export default {
  items: Array.from({ length: 3 }, (_, i) => ({ label: "row " + i })),
  get "items.*.size"() { return this["items.*.label"].length; },
};`, `<template data-wcs="for: items"><li data-wcs="textContent: .size"></li></template>`);
    expect(pathFindings(getter)).toEqual([]);
    const tree = page(`export default {
  $recursion: { "nodes.*": "children.*" },
  nodes: seed(),
};`, `<template data-wcs="for: nodes"><tree-node data-wcs="state: ."></tree-node></template>`);
    expect(pathFindings(tree)).toEqual([]);
  });

  it('キーに JSDoc の @type があれば開かず、打ち間違いを報告する（info は出さない）', () => {
    const html = page(`const init = load();
export default {
  /** @type {{ name: string, kana: string }} */
  team: init.team,
  /** @type {{ id: string, name: string }[]} */
  runners: init.runners,
};`, `<input data-wcs="value: team.name">
<input data-wcs="value: team.nmae">
<template data-wcs="for: runners"><input data-wcs="value: .name"><input data-wcs="value: .nmae"></template>`);
    expect(pathFindings(html)).toEqual([
      [WcsDiagnosticCode.BindingPathMissing, 'warning', 'team.nmae'],
      [WcsDiagnosticCode.BindingPathMissing, 'warning', '.nmae'],
    ]);
  });

  it('stateSchema があれば schema が決める（info は出さず、schema に無いパスは error）', () => {
    const html = page(`const init = load();
export default { team: init.team };`, `<input data-wcs="value: team.name">
<input data-wcs="value: team.nmae">`);
    const schema = { type: 'object', properties: { team: { type: 'object', properties: { name: { type: 'string' } } } } } as const;
    const found = validateDocument(html, { locale: 'en', applicationSchema: schema })
      .filter((d) => d.code === WcsDiagnosticCode.PathNonexistent || d.code === WcsDiagnosticCode.PathDynamicUnknown);
    expect(found.map((d) => [d.code, textOf(html, d)])).toEqual([[WcsDiagnosticCode.PathNonexistent, 'team.nmae']]);
  });

  it('その下を読むスクリプト・$watch のキーも「存在しない」と言わない', () => {
    const html = page(`const init = load();
export default {
  team: init.team,
  $watch: { "team.name"(v) { this.touched = true; } },
  touched: false,
  get label() { return this["team.name"] + this["team.kana"]; },
};`, '<p data-wcs="textContent: label"></p>');
    const found = validate(html);
    expect(ofCode(found, WcsDiagnosticCode.ReadPathMissing)).toEqual([]);
    expect(ofCode(found, WcsDiagnosticCode.WatchPathMissing)).toEqual([]);
  });

  it('作者のページの元の形（1 つの初期値から各キーへ配る）: 偽の binding-path-missing は 0 件、キーごとに info が 1 回', () => {
    const state = `import * as L from "./lib/entry-logic.js";
const newId = () => "r" + Math.random().toString(36).slice(2, 10);
const fresh = () => L.emptyEntry(newId);
const init = fresh();
function emptyErrs() {
  return { team: { name: "", kana: "" }, rep: { phone: "" }, runners: "" };
}
export default {
  team: init.team,
  rep: init.rep,
  runners: init.runners,
  options: init.options,
  errs: emptyErrs(),
  agreed: false,
  get fee() { return 12000; },
};`;
    const html = `<wcs-state src="state.js"></wcs-state>
<input data-wcs="value: team.name; attr.aria-invalid: errs.team.name|truthy">
<input data-wcs="value: team.kana">
<input data-wcs="value: rep.phone">
<template data-wcs="for: runners">
  <input data-wcs="value: .name">
  <input data-wcs="value: .kana">
  <p>{{ .best }}</p>
</template>
<input type="number" data-wcs="value: options.lunchJa">
<p data-wcs="textContent: errs.rep.phone"></p>
<p data-wcs="textContent: fee|locale"></p>
<input type="checkbox" data-wcs="checked: agreed">
<p data-wcs="textContent: agred"></p>`;
    const files = { 'state.js': state, 'lib/entry-logic.js': 'export function emptyEntry(id) { return make(id); }' };
    const found = validate(html, 'en', files);
    // 打ち間違い（agred）は今までどおり報告する
    expect(ofCode(found, WcsDiagnosticCode.BindingPathMissing).map((d) => textOf(html, d))).toEqual(['agred']);
    const infos = ofCode(found, WcsDiagnosticCode.PathDynamicUnknown);
    // ページでは src の上、ファイルではキーの上
    expect(infos.map((d) => [d.severity, d.origin?.path, state.slice(d.origin!.start, d.origin!.end)])).toEqual([
      ['info', 'state.js', 'team'],
      ['info', 'state.js', 'rep'],
      ['info', 'state.js', 'runners'],
      ['info', 'state.js', 'options'],
      ['info', 'state.js', 'errs'],
    ]);
    expect(infos.map((d) => /so the (\d+ paths|path) bound under it/.exec(d.message)?.[1])).toEqual(['2 paths', 'path', '3 paths', 'path', '2 paths']);
    // 読めないキーの下の型は分からないので、型の規則も何も言わない
    expect(ofCode(found, WcsDiagnosticCode.NumberWrittenAsString)).toEqual([]);
  });

  it('CLI: info だけのページは --strict でも exit 0', () => {
    const html = page(`const init = load();
export default { team: init.team };`, '<input data-wcs="value: team.name">');
    const result = runValidation([{ source: 'index.html', text: html, kind: 'html' }], { strict: true, locale: 'en' });
    expect([result.exitCode, result.errorCount, result.warningCount, result.infoCount]).toEqual([0, 0, 0, 1]);
  });
});

describe('L1 analyzeStatePaths — その場に書いた式の読み方', () => {
  it('リテラルでない式は中身の分からないキー（opaque）で、書かれた式（長ければ先頭）を持つ', () => {
    expect(opaqueOf(`import { emptyEntry } from "./shape.js";
const init = emptyEntry();
export default {
  team: init.team,
  called: emptyEntry(),
  made: new Map(),
  cond: a ? { x: 1 } : null,
  where: location.pathname,
  parsed: JSON.parse(localStorage.getItem("draft") ?? "{}"),
};`, { 'shape.js': SHAPE })).toEqual({
      team: { name: 'init.team' },
      called: { name: 'emptyEntry()', from: './shape.js' },
      made: { name: 'new Map()' },
      cond: { name: 'a ? { x: 1 } : null' },
      where: { name: 'location.pathname' },
      parsed: { name: 'JSON.parse(localStorage.getItem("draft"…' },
    });
  });

  it('読めるリテラル（数・文字列・null・関数・空の配列とオブジェクト・TypeScript の as）は開かない', () => {
    expect(opaqueOf(`export default {
  count: 0, ratio: -0.5, name: "x", tpl: \`a\`, none: null, undef: undefined, on: true,
  list: [], obj: {}, rows: [{ id: 1 }], typed: [] as Item[], sized: { w: 1 } satisfies Size,
  fn: function () {}, arrow: (a, b) => a + b, single: x => x, later: async () => {},
};`)).toEqual({});
  });

  it('リテラルに続けて呼び出し・メンバーを書いた値（[1, 2].map(…)・{ … }.rows）は、そのリテラルではないので開く', () => {
    expect(opaqueOf(`export default {
  rows: [1, 2, 3].map((n) => ({ id: n })),
  first: [{ id: 1 }][0],
  part: { rows: [] }.rows,
};`)).toEqual({
      rows: { name: '[1, 2, 3].map((n) => ({ id: n }))' },
      first: { name: '[{ id: 1 }][0]' },
      part: { name: '{ rows: [] }.rows' },
    });
  });

  it('先頭の行を書いていない配列（呼び出し・名前・spread）は行を開く。プリミティブと入れ子の配列は開かない', () => {
    expect(opaqueOf(`export default {
  runners: [newRunner(), newRunner()],
  saved: [...loadSaved()],
  named: [ROW_A, ROW_B],
  tags: ["a", "b"],
  nums: [1, 2],
  grid: [[1, 2], [3, 4]],
  empty: [],
};`)).toEqual({
      'runners.*': { name: 'newRunner()' },
      'saved.*': { name: '...loadSaved()' },
      'named.*': { name: 'ROW_A' },
    });
    const html = page('export default { runners: [newRunner(), newRunner()] };',
      '<template data-wcs="for: runners"><input data-wcs="value: .name"></template>');
    expect(pathFindings(html)).toEqual([[WcsDiagnosticCode.PathDynamicUnknown, 'info', 'runners']]);
    expect(validate(html).find((d) => d.code === WcsDiagnosticCode.PathDynamicUnknown)?.message)
      .toContain('The value of "runners.*" (newRunner()) cannot be read statically, so the path bound under it is not checked');
  });

  it('式の前のコメントは、文面に出す式に含めない', () => {
    expect(opaqueOf(`export default {
  made: /* the first entry */ makeEntry(),
  rows: [
    // one row to start with
    newRow(),
  ],
};`)).toEqual({ made: { name: 'makeEntry()' }, 'rows.*': { name: 'newRow()' } });
  });

  it('オブジェクトリテラルを束縛する const のメンバー（team: DEFAULTS.team）は、そのキーの形を読む', () => {
    const script = `import { DEFAULTS } from "./shape.js";
import * as S from "./shape.js";
const LOCAL = Object.freeze({ rep: { phone: "" }, nested: { deep: { leaf: 1 } } });
export default { team: DEFAULTS.team, rows: DEFAULTS.rows, rep: LOCAL.rep, leaf: LOCAL.nested.deep, viaNs: S.DEFAULTS.team };`;
    const paths = analyzeStatePaths(script, { fileReader: (p: string) => ({ 'shape.js': SHAPE } as Record<string, string>)[p], path: '' });
    expect(paths.filter((p) => p.opaque !== undefined)).toEqual([]);
    expect(paths.map((p) => p.path)).toEqual(expect.arrayContaining([
      'team.name', 'team.kana', 'rows.*.id', 'rows.*.label', 'rep.phone', 'leaf.leaf', 'viaNs.name',
    ]));
    const html = page(script, '<input data-wcs="value: team.name">\n<input data-wcs="value: team.nmae">');
    expect(pathFindings(html, { 'shape.js': SHAPE })).toEqual([[WcsDiagnosticCode.BindingPathMissing, 'warning', 'team.nmae']]);
  });

  it('辿れないメンバー（リテラルに無いキー・let・読めない import）は開く', () => {
    expect(opaqueOf(`import { DEFAULTS } from "./shape.js";
import { GONE } from "./missing.js";
let later = { a: { b: 1 } };
export default { none: DEFAULTS.nothing, deep: DEFAULTS.team.name.length, viaLet: later.a, gone: GONE.team };`, { 'shape.js': SHAPE })).toEqual({
      none: { name: 'DEFAULTS.nothing', from: './shape.js' },
      deep: { name: 'DEFAULTS.team.name.length', from: './shape.js' },
      viaLet: { name: 'later.a' },
      gone: { name: 'GONE.team', from: './missing.js' },
    });
  });
});

describe('L5 attr.* に boolean を束ねたとき', () => {
  const STATE = `export default {
  flag: false, n: 3, note: null, s: "x",
  /** @type {boolean | null} */
  maybe: null,
};`;
  const typeFindings = (body: string, locale = 'en'): WcsDiagnostic[] =>
    ofCode(validate(page(STATE, body), locale), WcsDiagnosticCode.BindingTypeExpectation);

  it('値が true / false の属性（ARIA の状態・contenteditable など）には何も言わない（ekiden-entry の attr.aria-invalid: flag|truthy）', () => {
    expect(typeFindings(`<p data-wcs="attr.aria-invalid: flag|truthy; attr.aria-busy: flag">x</p>
<button data-wcs="attr.aria-pressed: flag; attr.aria-expanded: n|gt(2); attr.aria-current: flag; attr.ARIA-HIDDEN: flag">x</button>
<div data-wcs="attr.contenteditable: flag; attr.draggable: flag; attr.spellcheck: flag">x</div>
<my-el data-wcs="attr.aria-selected: flag"></my-el>`)).toEqual([]);
  });

  it('論理属性は warning のまま、「"false" でも効く」とプロパティの束縛を言う', () => {
    const body = '<button data-wcs="attr.disabled: flag">x</button>';
    const [d] = typeFindings(body);
    expect([d.severity, textOf(page(STATE, body), d)]).toEqual(['warning', 'flag']);
    expect(d.message).toBe('"attr.disabled" is given a boolean. attr.* writes String(value), so false is written as disabled="false" — and a boolean attribute is on whenever it is present, whatever its value: disabled="false" still means disabled (only null / undefined remove an attribute). Bind the property instead: disabled: flag');
    const [ja] = typeFindings(body, 'ja');
    expect(ja.message).toBe('"attr.disabled" に boolean を束ねています。attr.* は String(value) を書くので、false のとき disabled="false" になります。論理属性は値に関係なく、在るだけで効きます: disabled="false" でも disabled のままです（属性を外すのは null / undefined だけ）。プロパティを束ねてください: disabled: flag');
  });

  it('プロパティの名前が属性と違うもの（readonly → readOnly）はその名前で、右辺は書かれたまま言う', () => {
    const found = typeFindings(`<input data-wcs="attr.readonly: n|gt(2); attr.required: flag|not">
<form data-wcs="attr.novalidate: flag"></form>
<div data-wcs="attr.hidden: flag; attr.inert: maybe">x</div>
<details data-wcs="attr.open: flag"></details>`);
    expect(found.map((d) => /Bind the property instead: (.*)$/.exec(d.message)?.[1])).toEqual([
      'readOnly: n|gt(2)', 'required: flag|not', 'noValidate: flag', 'hidden: flag', 'inert: maybe', 'open: flag',
    ]);
  });

  it('そのほかの属性（data-*・title・true / false を取らない ARIA・カスタム要素の属性）は「文字の "true" / "false"」と言う', () => {
    const body = `<div data-wcs="attr.data-open: flag">x</div>
<p data-wcs="attr.title: flag; attr.aria-label: flag">x</p>
<my-button data-wcs="attr.disabled: flag"></my-button>`;
    const found = typeFindings(body);
    expect(found.map((d) => [d.severity, /^"(attr\.[\w-]+)" is given a boolean/.exec(d.message)?.[1]])).toEqual([
      ['warning', 'attr.data-open'], ['warning', 'attr.title'], ['warning', 'attr.aria-label'], ['warning', 'attr.disabled'],
    ]);
    expect(found[0].message).toBe('"attr.data-open" is given a boolean. attr.* writes String(value), so the attribute is "true" or "false" and is never removed (only null / undefined remove it): whatever tests its presence — [data-open] in CSS, hasAttribute() — finds it either way. To remove it while false, write attr.data-open: flag|defaults(null); if the text "true" / "false" is what is meant, say so: attr.data-open: flag|string');
    const [ja] = typeFindings(body, 'ja');
    expect(ja.message).toBe('"attr.data-open" に boolean を束ねています。attr.* は String(value) を書くので、属性は "true" か "false" になり、外れることはありません（外すのは null / undefined だけ）。属性の有無を見る側（CSS の [data-open]・hasAttribute()）には、どちらでも在ります。false の間は外すなら attr.data-open: flag|defaults(null)、文字の "true" / "false" が意図なら attr.data-open: flag|string と書いてください');
  });

  it('|defaults(null)（false の間は属性を外す）と |string（文字が意図）には何も言わない', () => {
    expect(typeFindings(`<button data-wcs="attr.disabled: flag|defaults(null)">x</button>
<div data-wcs="attr.data-open: flag|defaults(null); attr.data-state: flag|string; attr.data-on: n|gt(2)|defaults(null)">x</div>`)).toEqual([]);
    // 引用符付きの 'null' は文字列で、属性は外れない
    expect(typeFindings(`<div data-wcs="attr.data-open: flag|defaults('null')">x</div>`)).toHaveLength(1);
  });

  it('boolean でない型と、class. / style. の検査は今までどおり', () => {
    const found = typeFindings(`<p data-wcs="attr.tabindex: n; attr.data-s: s; class.on: s; style.color: n; class.active: flag">x</p>`);
    expect(found.map((d) => d.message)).toEqual([
      '"attr.tabindex" requires a string (current type: number)',
      '"class.on" requires a boolean (current type: string)',
      '"style.color" requires a string (current type: number)',
    ]);
  });
});

describe('ekiden-entry の再現ページ（repro/lint/member.html）', () => {
  const PAGE = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>t</title>
<script type="module" src="https://esm.run/@wcstack/state@4.22.0/auto"></script></head>
<body>
<wcs-state>
  <script type="module">
    import { emptyEntry } from "./shape.js";
    const init = emptyEntry();
    const whole = emptyEntry();
    export default {
      team: init.team,
      rep: init.rep,
      whole,
      flag: false,
      count: 0,
      rows: [{ id: 1, sex: "m" }],
      get total() { return this.count + 1; },
    };
  </script>
</wcs-state>
<input data-wcs="value: team.name">
<input data-wcs="value: rep.phone">
<input data-wcs="value: whole.team.name">
<p data-wcs="attr.aria-invalid: flag|truthy; attr.aria-busy: flag">x</p>
<input type="number" data-wcs="value: count">
<span data-wcs="textContent: total"></span>
<template data-wcs="for: rows">
  <label><input type="radio" name="sex" value="m" data-wcs="radio: .sex">男</label>
  <label><input type="radio" name="sex" value="f" data-wcs="radio: .sex">女</label>
</template>
<form><input data-wcs="value: team.kana"><button type="reset">クリア</button></form>
</body></html>`;

  it('4.22 の出力（偽の binding-path-missing 3 件・aria の binding-type-expectation 2 件）が消え、新しい規則が 2 件出る', () => {
    const found = validate(PAGE, 'en', { 'shape.js': SHAPE });
    expect(found.map((d) => [d.code, d.severity, textOf(PAGE, d)])).toEqual([
      [WcsDiagnosticCode.PathDynamicUnknown, 'info', 'team'],
      [WcsDiagnosticCode.PathDynamicUnknown, 'info', 'rep'],
      [WcsDiagnosticCode.PathDynamicUnknown, 'info', 'whole'],
      [WcsDiagnosticCode.NumberWrittenAsString, 'warning', 'count'],
      [WcsDiagnosticCode.RadioNameShared, 'warning', 'name="sex"'],
    ]);
  });
});

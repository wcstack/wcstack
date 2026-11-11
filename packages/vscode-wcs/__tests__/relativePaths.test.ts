/**
 * relativePaths.test.ts — @wcstack/state 4.22 のスクリプトの 2 つの書き方:
 * 行からの相対パス（`this[".name"]`）と、1 つのアクセサを複数のパスに宣言するカンマ列挙のキー
 * （`get "users.*.fullname,employees.*.fullname"()`）。
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { WcsDiagnosticCode } from '../src/core/diagnostics.js';
import { accessorRow, analyzeCallableBodies, analyzeDeclarationSpans, analyzeStatePaths } from '../src/service/stateAnalyzer.js';
import { collectGetterReads } from '../src/service/scriptAst.js';

const page = (state: string, markup = '') => `<wcs-state><script type="module">export default {\n${state}\n};</script></wcs-state>${markup}`;
const all = (html: string) => validateDocument(html, { locale: 'en' });
const find = (html: string, code: string) => all(html).filter((d) => d.code === code);
const texts = (html: string, code: string) => find(html, code).map((d) => html.slice(d.start, d.end));
const PEOPLE = `users: [{ first: "Ada", last: "Lovelace" }], employees: [{ first: "Edsger", last: "Dijkstra" }],`;
const ROWS = `<template data-wcs="for: users"><li>{{ .full }}</li></template><template data-wcs="for: employees"><em>{{ .full }}</em></template>`;

describe('行のアクセサの中の相対パス', () => {
  it('アクセサの行は、キーの最後の `*` まで（再帰のキーは `**` まで。行のアクセサでなければ null）', () => {
    expect(accessorRow({ name: 'users.*.full', kind: 'getter' })).toBe('users.*');
    expect(accessorRow({ name: 'regions.*.states.*.label', kind: 'getter' })).toBe('regions.*.states.*');
    expect(accessorRow({ name: 'users.*.address.label', kind: 'getter' })).toBe('users.*');
    expect(accessorRow({ name: 'nodes.**.label', kind: 'getter' })).toBe('nodes.**');
    expect(accessorRow({ name: 'total', kind: 'getter' })).toBe(null);
    expect(accessorRow({ name: 'users.*.pick', kind: 'method' })).toBe(null);
  });

  it('`row` を渡すと、相対パスの読み書きは行の下のパスとして集まる（`.` は行そのもの、テンプレートの添字も）', () => {
    const reads = collectGetterReads('const a = this[".first"].length; this[".last"] = a; return this["."] && this.$getAll(".lines.*.amount") && this[`.lines.${i}.amount`];', { row: 'users.*', writes: true, templates: true })!;
    expect(reads.map((r) => [r.path, r.relative, r.form])).toEqual([
      ['users.*.first', '.first', 'member'],
      ['users.*.last', '.last', 'write'],
      ['users.*', '.', 'member'],
      ['users.*.lines.*.amount', '.lines.*.amount', 'api'],
      ['users.*.lines.*.amount', '.lines.*.amount', 'member'],
    ]);
    expect(reads[0].chain).toEqual(['users.*.first', 'length']);
    expect(reads[4].indexed).toEqual(['users.*.lines']);
  });

  it('`row` が無ければ、相対パスは書かれたまま集まる', () => {
    expect(collectGetterReads('return this[".first"] + this.count;')!.map((r) => [r.path, r.relative])).toEqual([['.first', undefined], ['count', undefined]]);
  });

  it('正しい相対パス（読み・setter の書き・$getAll・`.`）には何も出ない', () => {
    const html = page(`${PEOPLE} tags: ["a"], orders: [{ lines: [{ amount: 1 }] }],
  get "users.*.full"() { return this[".first"] + " " + this[".last"]; },
  set "users.*.full"(v) { [this[".first"], this[".last"]] = v.split(" "); },
  get "tags.*.upper"() { return this["."].toUpperCase(); },
  get "orders.*.total"() { return this.$getAll(".lines.*.amount").reduce((a, b) => a + b, 0); },
  get "orders.*.first"() { return this.$getAll(".lines.*.amount", [0, 0])[0]; },`,
    `<template data-wcs="for: users"><input data-wcs="value: .full"></template><template data-wcs="for: tags"><b>{{ .upper }}</b></template><template data-wcs="for: orders"><u>{{ .total }}{{ .first }}</u></template>`);
    expect(all(html)).toEqual([]);
  });

  it('相対パスの先の誤字は、展開したパスで wcs/read-path-missing・wcs/write-path-missing になる', () => {
    const html = page(`${PEOPLE}
  get "users.*.full"() { return this[".frist"] + this[".last"]; },
  set "users.*.full"(v) { this[".lsat"] = v; },`, `<template data-wcs="for: users"><input data-wcs="value: .full"></template>`);
    const read = find(html, WcsDiagnosticCode.ReadPathMissing);
    expect(read.map((d) => html.slice(d.start, d.end))).toEqual(['this[".frist"]']);
    expect(read[0].message).toContain('Path "users.*.frist" does not exist in the state definition.');
    expect(read[0].message).toContain('(".frist" in the accessor "users.*.full"). Did you mean "first"?');
    const write = find(html, WcsDiagnosticCode.WritePathMissing);
    expect(write.map((d) => html.slice(d.start, d.end))).toEqual(['this[".lsat"]']);
    expect(write[0].message).toContain('"users.*.lsat"');
  });

  it('getter が相対パスで読む値を setter が相対パスで書けば、wcs/setter-unobserved は出ない（絶対パスとの混在も）', () => {
    const html = page(`${PEOPLE}
  get "users.*.full"() { return this[".first"]; },
  set "users.*.full"(v) { this["users.*.first"] = v; },
  get "employees.*.full"() { return this["employees.*.first"]; },
  set "employees.*.full"(v) { this[".first"] = v; },`, ROWS.replaceAll('{{ .full }}', '<input data-wcs="value: .full">'));
    expect(all(html)).toEqual([]);
  });

  it('相対パスで書いても、getter が読まないものを書く setter は wcs/setter-unobserved', () => {
    const html = page(`${PEOPLE}
  get "users.*.full"() { return this[".first"]; },
  set "users.*.full"(v) { this[".last"] = v; },`, `<template data-wcs="for: users"><input data-wcs="value: .full"></template>`);
    const found = find(html, WcsDiagnosticCode.SetterUnobserved);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('writes "users.*.last"');
  });

  it('相対パスで自分のパスに書く setter は wcs/setter-cycle、相対パスで自分を読む getter は wcs/getter-cycle', () => {
    const html = page(`${PEOPLE}
  get "users.*.full"() { return this[".full"]; },
  set "users.*.full"(v) { this[".full"] = v; },`, `<template data-wcs="for: users"><input data-wcs="value: .full"></template>`);
    expect(find(html, WcsDiagnosticCode.SetterCycle).map((d) => d.severity)).toEqual(['error']);
    expect(find(html, WcsDiagnosticCode.GetterCycle)).toHaveLength(1);
  });

  it('getter の中の相対パスへの書き込みは wcs/getter-write', () => {
    const html = page(`${PEOPLE}\n  get "users.*.full"() { this[".first"] = "x"; return 1; },`, `<template data-wcs="for: users"><li>{{ .full }}</li></template>`);
    const found = find(html, WcsDiagnosticCode.GetterWrite);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['this[".first"]']);
    expect(found[0].message).toContain('writes "users.*.first"');
  });

  it('行のアクセサでない getter / setter の相対パスは wcs/wildcard-rank（error — 評価のたびに #1402）', () => {
    const html = page(`${PEOPLE} _n: 0,
  get first() { return this[".first"]; },
  set first(v) { this[".first"] = v; },
  get later() { return () => this[".first"]; },`, `<p>{{ first }}</p>`);
    const found = find(html, WcsDiagnosticCode.WildcardRank);
    expect(found.map((d) => [html.slice(d.start, d.end), d.severity])).toEqual([['this[".first"]', 'error'], ['this[".first"]', 'error']]);
    expect(found[0].message).toBe('".first" is relative to a row, but the accessor "first" is not one of a list\'s rows (its key has no "*"). With no row it throws each time it is evaluated (#1402). Write the full path, or make it a row accessor (get "<list>.*.<name>"())');
  });

  it('メソッドの中の相対パスは検査しない（行は呼び出し側で決まる）— 書き込み集合の規則も黙る', () => {
    const html = page(`${PEOPLE} picked: "",
  pick() { this.picked = this[".frist"]; this[".last"] = "x"; },
  get "users.*.full"() { return this[".first"]; },
  set "users.*.full"(v) { this.rename(v); },
  rename(v) { this[".first"] = v; },`, `<template data-wcs="for: users"><input data-wcs="value: .full"><button data-wcs="onclick: pick">x</button></template>`);
    expect(all(html)).toEqual([]);
  });

  it('添字を引数で受ける $resolve・$setAll・$update に渡した相対パスは wcs/wildcard-rank（error — メソッド・入れ子の関数の中でも）', () => {
    const html = page(`${PEOPLE} n: 0,
  get "users.*.a"() { return this.$resolve(".first", [0]); },
  set "users.*.a"(v) { this.$setAll(".first", [], v); this.$update(".last", [0], v); },
  rename() { this.$update(".first", [0], "x"); return () => this.$resolve(".", [0], 1); },
  get "users.*.ok"() { return this.$getAll(".first").length; },`, `<template data-wcs="for: users"><input data-wcs="value: .a">{{ .ok }}</template>`);
    const found = find(html, WcsDiagnosticCode.WildcardRank);
    expect(found.map((d) => [html.slice(d.start, d.end), d.severity])).toEqual([
      ['this.$resolve(".first", [0])', 'error'], ['".first"', 'error'], ['".last"', 'error'], ['".first"', 'error'], ['"."', 'error'],
    ]);
    expect(found[1].message).toBe('".first" is relative to a row, but $setAll takes its rows from its indexes argument, not from the row it is called at. A relative path is not expanded there, and the call throws. Write the full path ("<list>.*.first")');
    expect(found[4].message).toContain('Write the full path ("<list>.*")');
    expect(all(html).filter((d) => d.code !== WcsDiagnosticCode.WildcardRank)).toEqual([]);
  });

  it('$getAll の添字の本数は、相対パスでは数えない（行の `*` が加わる）', () => {
    const html = page(`orders: [{ lines: [{ amount: 1 }] }],
  get "orders.*.x"() { return this.$getAll(".lines.*.amount", [0, 0]); },
  get "orders.*.y"() { return this.$getAll("orders.*.lines.*.amount", [0, 0, 0]); },`, `<template data-wcs="for: orders"><u>{{ .x }}{{ .y }}</u></template>`);
    expect(texts(html, WcsDiagnosticCode.IndexArity)).toEqual(['[0, 0, 0]']);
  });

  it('再帰の getter の中の相対パスは `**` の下のパスとして読まれ、検査されない', () => {
    const html = page(`nodes: [{ name: "a", children: [] }], $recursion: { "nodes.*": "children.*" },
  get "nodes.**.label"() { return this[".nmae"]; },`, `<template data-wcs="for: nodes"><i>{{ .label }}</i></template>`);
    expect(find(html, WcsDiagnosticCode.ReadPathMissing)).toEqual([]);
    expect(find(html, WcsDiagnosticCode.WildcardRank)).toEqual([]);
  });
});

describe('1 つのアクセサを複数のパスに宣言するカンマ列挙のキー', () => {
  const LISTED = `${PEOPLE}
  get "users.*.full,employees.*.full"() { return this[".first"] + " " + this[".last"]; },
  set "users.*.full,employees.*.full"(v) { [this[".first"], this[".last"]] = v.split(" "); },`;

  it('列挙したパスのそれぞれが、宣言された計算パスになる（get / set の組は 1 候補、書けるパス）', () => {
    const paths = analyzeStatePaths(`export default {\n${LISTED}\n};`).filter((p) => p.kind === 'computed');
    expect(paths.map((p) => [p.path, p.settable])).toEqual([['users.*.full', true], ['employees.*.full', true]]);
  });

  it('宣言の範囲は、キーの中のそのパスだけを指す（定義へ移動・参照の検索がパスごとに当たる）', () => {
    const script = `export default {\n${LISTED}\n};`;
    const spans = analyzeDeclarationSpans(script).filter((s) => s.kind === 'getter');
    expect(spans.map((s) => [s.name, script.slice(s.start, s.end)])).toEqual([
      ['users.*.full', 'users.*.full'], ['employees.*.full', 'employees.*.full'],
      ['users.*.full', 'users.*.full'], ['employees.*.full', 'employees.*.full'],
    ]);
  });

  it('本体はパスごとに 1 件ずつ返り、どれも同じ並びと元のキーを持つ', () => {
    const script = `export default {\n${LISTED}\n};`;
    const bodies = analyzeCallableBodies(script).filter((c) => c.accessor === 'get');
    expect(bodies.map((c) => c.name)).toEqual(['users.*.full', 'employees.*.full']);
    expect(bodies[0].body).toBe(bodies[1].body);
    expect(bodies[1].listed!.paths).toEqual(['users.*.full', 'employees.*.full']);
    expect(script.slice(bodies[1].listed!.start, bodies[1].listed!.end)).toBe('users.*.full,employees.*.full');
  });

  it('どのリストの行のバインディングも、列挙したアクセサを見つける（双方向も書ける）', () => {
    const html = page(LISTED, ROWS.replaceAll('{{ .full }}', '<input data-wcs="value: .full">'));
    expect(all(html)).toEqual([]);
  });

  it('列挙していないリストの行のバインディングは wcs/binding-path-missing のまま', () => {
    const html = page(`${PEOPLE}\n  get "users.*.full"() { return this[".first"]; },`, ROWS);
    expect(texts(html, WcsDiagnosticCode.BindingPathMissing)).toEqual(['.full']);
  });

  it('相対パスの先は、列挙したリストごとに検査する（片方のリストにだけ無い値）', () => {
    const html = page(`users: [{ first: "Ada", last: "Lovelace" }], employees: [{ first: "Edsger", lastt: "Dijkstra" }],
  get "users.*.full,employees.*.full"() { return this[".first"] + " " + this[".last"]; },`, ROWS);
    const found = find(html, WcsDiagnosticCode.ReadPathMissing);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['this[".last"]']);
    expect(found[0].message).toContain('Path "employees.*.last" does not exist in the state definition.');
    expect(found[0].message).toContain('(".last" in the accessor "employees.*.full"). Did you mean "lastt"?');
  });

  it('どのリストにも無い値は、本体の 1 か所につき 1 回だけ言う', () => {
    const html = page(`${PEOPLE}\n  get "users.*.full,employees.*.full"() { return this[".frist"]; },`, ROWS);
    const found = find(html, WcsDiagnosticCode.ReadPathMissing);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('"users.*.frist"');
  });

  it('getter の中の書き込み（wcs/getter-write）も、本体の 1 か所につき 1 回', () => {
    const html = page(`${PEOPLE} n: 0,\n  get "users.*.full,employees.*.full"() { this.n = 1; this[".first"] = "x"; return 1; },`, ROWS);
    expect(texts(html, WcsDiagnosticCode.GetterWrite)).toEqual(['this.n', 'this[".first"]']);
  });

  it('列挙した getter に setter が無ければ、どのパスへの書き込みも wcs/path-readonly', () => {
    const html = page(`${PEOPLE}
  get "users.*.full,employees.*.full"() { return this[".first"]; },
  reset() { this.$setAll("employees.*.full", [], ""); },`, ROWS);
    expect(texts(html, WcsDiagnosticCode.PathReadonly)).toEqual(['"employees.*.full"']);
  });

  it('複数のリストに宣言した本体の絶対パスは wcs/accessor-list-path（error、相対の書き方を言う）', () => {
    const html = page(`${PEOPLE}
  get "users.*.full,employees.*.full"() { return this["users.*.first"] + " " + this[".last"]; },
  set "users.*.full,employees.*.full"(v) { this["employees.*.last"] = v; this[".first"] = v; },`, ROWS.replaceAll('{{ .full }}', '<input data-wcs="value: .full">'));
    const found = find(html, WcsDiagnosticCode.AccessorListPath);
    expect(found.map((d) => [html.slice(d.start, d.end), d.severity])).toEqual([['this["users.*.first"]', 'error'], ['this["employees.*.last"]', 'error']]);
    expect(found[0].message).toBe('"users.*.first" is a path of the rows of "users", and this accessor is also declared for "employees.*.full": at its rows that path has no row, so a read gives undefined and a write throws. Write it relative to the row: this[".first"]');
    expect(found[1].message).toContain('also declared for "users.*.full"');
  });

  it('同じリストの 2 つの名前・外側の行・添字を渡す $getAll・明示の添字のパスは wcs/accessor-list-path にならない', () => {
    const html = page(`regions: [{ name: "r", states: [{ name: "s" }], towns: [{ name: "t" }] }], users: [{ first: "Ada" }],
  get "users.*.full,users.*.display"() { return this["users.*.first"]; },
  get "regions.*.states.*.label,regions.*.towns.*.label"() {
    return this["regions.*.name"] + this[".name"] + this.$getAll("regions.*.states.*.name", []).length + this["regions.0.name"];
  },`, `<template data-wcs="for: users"><li>{{ .full }}{{ .display }}</li></template><template data-wcs="for: regions"><template data-wcs="for: .states"><i>{{ .label }}</i></template><template data-wcs="for: .towns"><i>{{ .label }}</i></template></template>`);
    expect(all(html)).toEqual([]);
  });

  it('カンマの前後の空白・空の項目・再帰のパスは wcs/accessor-list-syntax（error、キーごとに 1 回）', () => {
    const html = page(`${PEOPLE} nodes: [], $recursion: { "nodes.*": "children.*" },
  get "users.*.full, employees.*.full"() { return this[".first"]; },
  set "users.*.full, employees.*.full"(v) { this[".first"] = v; },
  get "users.*.a,,employees.*.a"() { return this[".first"]; },
  get "nodes.**.a,nodes.**.b"() { return 1; },`, ROWS.replaceAll('{{ .full }}', '<input data-wcs="value: .full">'));
    const found = find(html, WcsDiagnosticCode.AccessorListSyntax);
    expect(found.map((d) => [html.slice(d.start, d.end), d.severity])).toEqual([
      ['users.*.full, employees.*.full', 'error'],
      ['users.*.full, employees.*.full', 'error'],
      ['users.*.a,,employees.*.a', 'error'],
      ['nodes.**.a,nodes.**.b', 'error'],
    ]);
    expect(found[0].message).toBe('The accessor key "users.*.full, employees.*.full" lists several paths, but has a space beside a comma. Separate the paths with "," alone (get "users.*.fullname,employees.*.fullname"()): the runtime takes what is between the commas as it is, so this declares a path nothing reads');
    expect(found[2].message).toContain('has an empty entry');
    expect(found[3].message).toContain('a recursive path ("**") cannot be listed');
    // (the paths are read without the spaces, so the mistake is said once: no binding-path-missing beside it)
    expect(find(html, WcsDiagnosticCode.BindingPathMissing)).toEqual([]);
  });

  it('`*` の無いパスを並べたアクセサの相対パスは wcs/wildcard-rank、行のパスが 1 つでもあれば言わない', () => {
    const html = page(`${PEOPLE} n: 1,
  get "double,twice"() { return this[".n"]; },
  get "users.*.x,total"() { return this[".first"]; },`, `<p>{{ double }}{{ twice }}{{ total }}</p>`);
    const found = find(html, WcsDiagnosticCode.WildcardRank);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['this[".n"]']);
    expect(found[0].message).toContain('the accessor "double,twice"');
  });

  it('日本語の文面', () => {
    const html = page(`${PEOPLE}\n  get "users.*.full, employees.*.full"() { return this["users.*.first"]; },\n  get n() { return this[".first"]; },`, ROWS);
    const ja = validateDocument(html, { locale: 'ja' });
    expect(ja.find((d) => d.code === WcsDiagnosticCode.AccessorListSyntax)!.message).toContain('カンマの前後に空白があります');
    expect(ja.find((d) => d.code === WcsDiagnosticCode.AccessorListPath)!.message).toContain('行からの相対パスで書いてください: this[".first"]');
    expect(ja.find((d) => d.code === WcsDiagnosticCode.WildcardRank)!.message).toContain('行からの相対パスですが');
  });
});

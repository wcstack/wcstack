/**
 * frameworkHabitsLint.test.ts — 継ぎ目アプリ street-reports（React のアプリを wcstack に移した作者）で見つかった、ほかの
 * フレームワークの癖の lint（4.30）。ランタイムが拒むか黙って落とすものは error、ほかは warning（著者の決定 2026-11-25）。
 *
 *   1. `wcs/binding-expression` — 束縛の右辺が式（error）
 *   2. `wcs/attribute-mustache` — 属性の値の `{{ }}`（warning）
 *   3. `wcs/structural-element` — `<template>` でない要素の `if:` / `for:`（error）
 *   4. `wcs/collection-mutation` — state の Set / Map をその場で変える（error）
 *   5. `wcs/row-id-shared` — 行のリテラルの id（warning）
 *   6. `wcs/event-name-case` — `onSubmit:`（warning）
 *   7. `wcs/inline-import` — インラインのスクリプトの相対 import（error）
 *   8. `wcs/key-binding` — `key:`（warning）
 *   9. `--strict` — 検査できなかった state の info を warning と同じく数える
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { runValidation } from '../src/core/cli/runValidation.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics.js';
import { filterHint, isBindingExpression } from '../src/service/frameworkHabitsValidator.js';

const validate = (html: string, locale = 'en', files: Record<string, string> = {}): WcsDiagnostic[] =>
  validateDocument(html, { locale, fileReader: (p: string) => files[p] });
const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const textOf = (html: string, d: WcsDiagnostic): string => html.slice(d.start, d.end);
const STATE = `  loading: false, count: 0, status: "new", done: false, reportedAt: "", id: 1, open: true, kind: "a", title: "t",
  price: 0, user: { name: "a" }, matrix: [[1]],
  items: [{ id: 1, t: "a", status: "new", name: "x", kind: "k" }],
  remove(e, i) {}, toggleRow(e, i) {}, submit(e) {},`;
const page = (body: string, state = STATE): string => `<wcs-state><script type="module">
export default {
${state}
};
</script></wcs-state>
${body}`;
const row = (inner: string): string => `<ul><template data-wcs="for: items"><li>${inner}</li></template></ul>`;

// ---------------------------------------------------------------------------------------------------------------------
describe('1. wcs/binding-expression — 束縛の右辺が式', () => {
  const expressions = (html: string, locale = 'en'): WcsDiagnostic[] => ofCode(validate(html, locale), WcsDiagnosticCode.BindingExpression);

  it.each([
    ['<p data-wcs="hidden: !loading"></p>', '!loading', 'loading|not'],
    ['<p data-wcs="textContent: count + 1"></p>', 'count + 1', 'count|add(1)'],
    [`<p data-wcs="class.active: status === 'new'"></p>`, "status === 'new'", 'status|eq(new)'],
    [`<p data-wcs="textContent: done ? '完了' : '未完了'"></p>`, "done ? '完了' : '未完了'", null],
    ['<a data-wcs="attr.href: `/reports/${id}`"></a>', '`/reports/${id}`', null],
    [`<p data-wcs="textContent: '件数: ' + count"></p>`, "'件数: ' + count", null],
    ['<p data-wcs="textContent: formatDate(reportedAt)"></p>', 'formatDate(reportedAt)', null],
    ['<p data-wcs="textContent: items.map(i => i.t)"></p>', 'items.map(i => i.t)', null],
    ['<template data-wcs="if: items.length > 0"><p></p></template>', 'items.length > 0', 'items.length|gt(0)'],
    ['<p>{{ count + 1 }}</p>', 'count + 1', 'count|add(1)'],
    ['<p><!--@@: count >= 2 --></p>', 'count >= 2', 'count|ge(2)'],
    [row(`<span data-wcs="class.is-new: .status === 'new'"></span>`), ".status === 'new'", '.status|eq(new)'],
    [row(`<span data-wcs="className: selected.has(.id) ? 'selected' : ''"></span>`), "selected.has(.id) ? 'selected' : ''", null],
    ['<p data-wcs="textContent: price|locale; hidden: count && loading"></p>', 'count && loading', null],
  ])('%s を error にし、範囲は右辺の式（最初の | より前）', (body, expr, fix) => {
    const html = page(body);
    const found = expressions(html);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['error', expr]]);
    expect(found[0].message).toContain(fix === null ? 'Write a getter in the state' : `Write ${fix}`);
  });

  it('メッセージは en と ja の両方', () => {
    const html = page('<p data-wcs="hidden: !loading"></p>');
    expect(expressions(html)[0].message).toBe('A binding takes a path and filters, not an expression: "!loading" is not evaluated, it is looked up as a path of that name. Write loading|not');
    expect(expressions(html, 'ja')[0].message).toBe('束縛の右辺はパスとフィルタで、式ではありません: "!loading" は評価されず、その名前のパスとして引かれます。loading|not と書いてください');
    const getter = page('<p data-wcs="textContent: formatDate(reportedAt)"></p>');
    expect(expressions(getter, 'ja')[0].message).toContain('その値を計算する getter を state に書き、getter の名前を束ねてください');
  });

  it('イベントの束縛の呼び出し・アロー関数は、ハンドラはメソッドの名前だと言う（en / ja）', () => {
    const html = page(row('<button data-wcs="onclick: remove(.id)"></button><input type="checkbox" data-wcs="onchange: () => toggleRow(.id)">'));
    const found = expressions(html);
    expect(found.map((d) => textOf(html, d))).toEqual(['remove(.id)', '() => toggleRow(.id)']);
    expect(found[0].message).toBe('An event binding names a method, not a call or a function: "remove(.id)" is not evaluated. Write "onclick: remove"; the handler is called with (event, ...loopIndexes), so read the row\'s values in the method through the loop index');
    expect(found[1].message).toContain('Write "onchange: toggleRow"');
    expect(expressions(html, 'ja')[0].message).toBe('イベントの束縛の右辺はメソッドの名前で、呼び出しや関数ではありません: "remove(.id)" は評価されません。"onclick: remove" と書いてください。ハンドラは (event, ...ループの添字) で呼ばれるので、行の値はメソッドの中で添字から読んでください');
  });

  it('同じ文字列について binding-path-missing / wildcard-rank / path-nonexistent を重ねない', () => {
    const html = page(`<p data-wcs="hidden: !loading"></p><p>{{ count + 1 }}</p><p data-wcs="class.is-new: .status === 'new'"></p>`);
    const found = validate(html);
    const codes = found.filter((d) => d.severity !== 'info').map((d) => d.code);
    expect(codes).toEqual([WcsDiagnosticCode.BindingExpression, WcsDiagnosticCode.BindingExpression, WcsDiagnosticCode.BindingExpression]);
    // stateSchema のある page でも、path-nonexistent（error）は出ない
    const schema = { type: 'object', properties: { loading: { type: 'boolean' } } };
    const withSchema = validateDocument(page('<p data-wcs="hidden: !loading"></p>'), { locale: 'en', applicationSchema: schema as never });
    expect(withSchema.map((d) => d.code)).not.toContain(WcsDiagnosticCode.PathNonexistent);
    expect(ofCode(withSchema, WcsDiagnosticCode.BindingExpression)).toHaveLength(1);
  });

  it.each([
    '<p data-wcs="hidden: count|gt(0); textContent: price|locale(ja-JP)"></p>',
    `<p data-wcs="hidden: status|eq(new); textContent: title|defaults('a, b')"></p>`,
    '<input data-wcs="value#ro: title; checked#init=element: done">',
    '<p data-wcs="textContent: user.name; hidden: $1"></p>',
    row('<span data-wcs="textContent: .name; title: .; hidden: items.*.id; class: items.0.kind"></span>'),
    '<p data-wcs="...: user"></p>',
    '<template data-wcs="if: open"><p></p></template><template data-wcs="else:"><p></p></template>',
    '<wcs-fetch data-wcs="command.fetch: $command.load; eventToken.response: loaded"></wcs-fetch>',
    '<p>{{ count|gt(0) }}<!--@@: title|upper --></p>',
    '<p data-wcs="textContent: matrix.*.*"></p>',
  ])('%s は式ではない', (body) => {
    expect(expressions(page(body))).toEqual([]);
  });

  it('`a || b` は空のフィルタとしてパーサが拒む（wcs/binding-syntax）ので重ねない', () => {
    expect(expressions(page('<p data-wcs="textContent: title || kind"></p>'))).toEqual([]);
  });

  it('<wcs-state> の無いファイルの {{ }} は別のテンプレートのもの（Handlebars の {{#each}}）— 言わない。data-wcs の式は言う', () => {
    expect(ofCode(validate('<ul>{{#each events}}<li>{{> card}}</li>{{/each}}</ul>'), WcsDiagnosticCode.BindingExpression)).toEqual([]);
    expect(ofCode(validate('<p data-wcs="hidden: !open"></p>'), WcsDiagnosticCode.BindingExpression)).toHaveLength(1);
  });

  it('isBindingExpression / filterHint', () => {
    expect(['a.b', '.', '.x', '$1', 'items.*.name', 'a-b', '名前']).toEqual(['a.b', '.', '.x', '$1', 'items.*.name', 'a-b', '名前'].filter((p) => !isBindingExpression(p)));
    expect(isBindingExpression('a@b c')).toBe(false);
    expect(filterHint('x !== "a"')).toBe('x|ne(a)');
    expect(filterHint('x < 3')).toBe('x|lt(3)');
    expect(filterHint('x <= 3')).toBe('x|le(3)');
    expect(filterHint('x * 2')).toBe('x|mul(2)');
    expect(filterHint('x === true')).toBe('x|eq(true)');
    expect(filterHint('x === y')).toBeNull();
    expect(filterHint("x > 'a'")).toBeNull();
    expect(filterHint("x === 'a, b'")).toBeNull();
    expect(filterHint('!a.b()')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('2. wcs/attribute-mustache — 属性の値の {{ }}', () => {
  const mustaches = (html: string, locale = 'en', files: Record<string, string> = {}): WcsDiagnostic[] =>
    ofCode(validate(html, locale, files), WcsDiagnosticCode.AttributeMustache);

  it('href / class / alt / <wcs-link to> の {{ }} を属性ごとに 1 回、warning で言う（範囲は最初の {{ }}）', () => {
    const html = page(`<a href="/reports/{{ id }}" class="row {{ kind }} {{ status }}" data-wcs="textContent: title">x</a>
<img alt="{{ title }}">${row('<wcs-link to="/reports/{{ .id }}">l</wcs-link>')}`);
    const found = mustaches(html);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([
      ['warning', '{{ id }}'], ['warning', '{{ kind }}'], ['warning', '{{ title }}'], ['warning', '{{ .id }}'],
    ]);
    expect(found[0].message).toBe('{{ }} is read in text only: in the attribute "href" it stays as written. Bind the attribute (attr.href: <path>, with a getter that builds the string) — a server-side template that fills it before the page is served is fine');
    expect(mustaches(html, 'ja')[0].message).toBe('{{ }} はテキストの中でしか読まれません。属性 "href" の中では書いたまま残ります。属性を束ねてください（attr.href: <パス>。文字列を組み立てる getter を書いて）。ページを返す前にサーバーのテンプレートが埋めるのなら、このままで正しい書き方です');
    // 属性の {{ }} はパスとして検査しない（binding-path-missing は出ない）
    expect(validate(html).filter((d) => textOf(html, d).includes('{{')).map((d) => d.code)).toEqual(found.map(() => WcsDiagnosticCode.AttributeMustache));
  });

  it('<wcs-state> の無いファイル・data-wcs-ignore の中・<script> / <style> の中・束縛属性の値では言わない', () => {
    expect(mustaches('<a href="/r/{{ id }}">x</a>')).toEqual([]);
    expect(mustaches(page('<div data-wcs-ignore><a href="/r/{{ id }}">x</a></div>'))).toEqual([]);
    expect(mustaches(page('<script>const a = `<a href="{{ id }}">`;</script><style>a[title="{{x}}"]{}</style>'))).toEqual([]);
    expect(mustaches(page(`<p data-wcs="textContent: title|defaults('{{x}}')"></p>`))).toEqual([]);
  });

  it('$behavior: { enableMustache: false } のページ（{{ }} はサーバーのテンプレートのもの）では言わない', () => {
    const html = page('<a href="/r/{{ id }}">x</a>', `  $behavior: { enableMustache: false },\n${STATE}`);
    expect(mustaches(html)).toEqual([]);
  });

  it('DCC の定義の中でも、定義の <wcs-state> があれば言う', () => {
    const html = `<my-card data-wc-definition><template shadowrootmode="open"><wcs-state><script type="module">export default { title: "a" };</script></wcs-state><img alt="{{ title }}"></template></my-card>`;
    expect(mustaches(html).map((d) => textOf(html, d))).toEqual(['{{ title }}']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('3. wcs/structural-element — <template> でない要素の構造の束縛', () => {
  const structural = (html: string, locale = 'en'): WcsDiagnostic[] => ofCode(validate(html, locale), WcsDiagnosticCode.StructuralElement);

  it('<p data-wcs="if: open"> / <li data-wcs="for: items"> を error にし、範囲は左辺', () => {
    const html = page('<p data-wcs="if: open">a</p><ul><li data-wcs="for: items">x</li></ul><p data-wcs=" else: ">b</p><p data-wcs="elseif: done">c</p>');
    const found = structural(html);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['error', 'if'], ['error', 'for'], ['error', 'else'], ['error', 'elseif']]);
    expect(found[0].message).toBe('"if:" works on a <template> only: on <p> the runtime sets a property named "if" and does nothing else — the element is always shown. Put the element inside <template data-wcs="if: …">');
    expect(found[1].message).toContain('the element is drawn once, not once per row');
    expect(found[2].message).toContain('<template data-wcs="else:">');
    expect(structural(html, 'ja')[1].message).toBe('"for:" は <template> の上でだけ働きます。<li> の上ではランタイムは "for" という名前のプロパティを書くだけで、要素は行ごとではなく 1 つだけ描かれます。要素を <template data-wcs="for: …"> の中に入れてください');
  });

  it('<template> の上（<svg> の中も）・ほかの束縛と並んだもの（wcs/template-syntax が言う）・for#x は言わない', () => {
    expect(structural(page('<template data-wcs="if: open"><p></p></template><svg><template data-wcs="for: items"><circle/></template></svg>'))).toEqual([]);
    const both = page('<p data-wcs="if: open; textContent: title">a</p>');
    expect(structural(both)).toEqual([]);
    expect(ofCode(validate(both), WcsDiagnosticCode.TemplateSyntax).map((d) => d.severity)).toEqual(['error']);
    expect(structural(page('<p data-wcs="for#x: items">a</p>'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('4. wcs/collection-mutation — state の Set / Map をその場で変える', () => {
  const mutations = (html: string, locale = 'en'): WcsDiagnostic[] => ofCode(validate(html, locale), WcsDiagnosticCode.CollectionMutation);
  const state = (methods: string): string => `  selected: new Set(), byId: new Map([["a", 1]]), list: [], plain: {},
${methods}`;

  it('add / delete / clear（Set）・set / delete / clear（Map）を error にし、範囲は this.<key>.<method>', () => {
    const html = page('', state(`  pick(e, id) { this.selected.add(id); this.selected.delete(id); this.selected.clear(); },
  put(k, v) { this.byId.set(k, v); this.byId.delete(k); this.byId.clear(); },`));
    const found = mutations(html);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([
      ['error', 'this.selected.add'], ['error', 'this.selected.delete'], ['error', 'this.selected.clear'],
      ['error', 'this.byId.set'], ['error', 'this.byId.delete'], ['error', 'this.byId.clear'],
    ]);
    expect(found[0].message).toBe('"this.selected.add(…)" changes the state\'s Set in place: the state does not see it, so nothing bound to "selected" and no getter that reads it is updated — nothing says so. Assign a new Set (this.selected = new Set([...this.selected, id])), or keep an array / an object');
    expect(found[3].message).toContain('this.byId = new Map([...this.byId, [key, value]])');
    expect(mutations(html, 'ja')[0].message).toBe('"this.selected.add(…)" は state の Set をその場で変えます。state はそれを見ないので、"selected" に束ねたものも、それを読む getter も更新されません（何も知らせません）。新しい Set を代入する（this.selected = new Set([...this.selected, id])）か、配列 / オブジェクトで持ってください');
  });

  it('$watch / $on のハンドラの中でも言う', () => {
    const html = page('', state(`  $watch: { list(v) { this.selected.add(v); } },`));
    expect(mutations(html).map((d) => textOf(html, d))).toEqual(['this.selected.add']);
  });

  it('確かでないものは言わない: 種が Set / Map でない・別の変数・同じ本体でキーを代入し直す・Set に set・コメントの中', () => {
    const html = page('', state(`  a(id) { this.list.push; this.plain.set(id, 1); },
  b(id) { const s = this.selected; s.add(id); },
  c(id) { this.selected.add(id); this.selected = new Set(this.selected); },
  d(id) { this.selected.set(id); this.byId.add(id); },
  e(id) { // this.selected.add(id)
  },`));
    expect(mutations(html)).toEqual([]);
  });

  it('src= の state ファイルでも言う（ファイルの中の位置で）', () => {
    const files = { './s.js': 'export default {\n  selected: new Set(),\n  pick(e, id) { this.selected.add(id); },\n};\n' };
    const found = ofCode(validate('<wcs-state src="./s.js"></wcs-state><p data-wcs="textContent: selected"></p>', 'en', files), WcsDiagnosticCode.CollectionMutation);
    expect(found).toHaveLength(1);
    expect(found[0].origin?.path).toBe('./s.js');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('5. wcs/row-id-shared — for: の行のリテラルの id', () => {
  const ids = (html: string, locale = 'en'): WcsDiagnostic[] => ofCode(validate(html, locale), WcsDiagnosticCode.RowIdShared);

  it('行の中のリテラルの id を (テンプレート, id) ごとに 1 回、warning で言う（範囲は id 属性）', () => {
    const html = page(row('<label for="cb">x</label><input id="cb" type="checkbox"><span id="cb">y</span><div><b id="deep">z</b></div>'));
    const found = ids(html);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['warning', 'id="cb"'], ['warning', 'id="deep"']]);
    expect(found[0].message).toBe('Every row of the for: gets id="cb": an id belongs to one element, so a <label for> or aria-labelledby that names it reaches the first row only. Bind it (attr.id: .domId, with a row getter that builds it from the row\'s key)');
    expect(ids(html, 'ja')[0].message).toBe('for: のすべての行が id="cb" になります。id は 1 つの要素のもので、それを名指す <label for> や aria-labelledby は最初の行にしか届きません。id を束ねてください（attr.id: .domId — 行のキーから組み立てる行の getter を書いて）');
  });

  it('入れ子の for: では内側の行ごとに数える', () => {
    const html = page('<template data-wcs="for: matrix"><template data-wcs="for: .*"><i id="cell"></i></template><b id="r"></b></template>');
    expect(ids(html).map((d) => textOf(html, d))).toEqual(['id="cell"', 'id="r"']);
  });

  it('束ねた id（attr.id: / id: / スプレッド）・行の外・行の中の if: の枝・shadow root の中は言わない', () => {
    expect(ids(page(row('<b data-wcs="attr.id: .id" id="tmp"></b><i data-wcs="id: .name" id="x"></i><u data-wcs="...: ." id="y"></u>')))).toEqual([]);
    expect(ids(page('<p id="solo"></p>'))).toEqual([]);
    // 枝は 1 行だけで描かれることがある（examples/homeroom の if: .answering）— 確かでない
    expect(ids(page(row('<template data-wcs="if: .status"><textarea id="answer"></textarea></template>')))).toEqual([]);
    expect(ids(page(row('<my-el><template shadowrootmode="open"><p id="inner"></p></template></my-el>')))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('6. wcs/event-name-case — onSubmit:（JSX の綴り）', () => {
  const cases = (html: string, locale = 'en'): WcsDiagnostic[] => ofCode(validate(html, locale), WcsDiagnosticCode.EventNameCase);

  it('on の直後が大文字のイベント束縛を warning にし、範囲は修飾子を除いた名前', () => {
    const html = page('<form data-wcs="onSubmit: submit"><button data-wcs="onClick#prevent: submit"></button><input data-wcs="onChange: submit"></form>');
    const found = cases(html);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['warning', 'onSubmit'], ['warning', 'onClick'], ['warning', 'onChange']]);
    expect(found[0].message).toBe('"onSubmit:" listens for an event named "Submit", which nothing dispatches — DOM event names are lower case. Write "onsubmit:" for the DOM event; a callback "prop" of a part is an event the part dispatches, bound with eventToken.<member>:');
    expect(cases(html, 'ja')[0].message).toBe('"onSubmit:" は "Submit" という名前のイベントを聞きますが、それを送るものはありません — DOM のイベント名は小文字です。DOM のイベントなら "onsubmit:" と書いてください。部品のコールバック（"prop"）は部品が送るイベントで、eventToken.<メンバー>: で束ねます');
  });

  it('小文字のイベント・明示のプロパティ形（.onClick:）・on の後が小文字のカスタムイベントは言わない', () => {
    expect(cases(page('<form data-wcs="onsubmit: submit; .onClick: submit"><my-el data-wcs="onvalueChanged: submit"></my-el></form>'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('7. wcs/inline-import — インラインのスクリプトの相対 import', () => {
  const imports = (html: string, locale = 'en', files: Record<string, string> = {}): WcsDiagnostic[] =>
    ofCode(validate(html, locale, files), WcsDiagnosticCode.InlineImport);

  it('./ ../ / の静的 import と再 export を error にし、範囲は指定子の文字列', () => {
    const html = `<wcs-state><script type="module">
import { a } from "./fmt.js";
import b from '../lib/b.js';
import "/js/c.js";
export { d } from "./d.js";
export default { x: 1 };
</script></wcs-state>`;
    const found = imports(html);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([
      ['error', '"./fmt.js"'], ['error', "'../lib/b.js'"], ['error', '"/js/c.js"'], ['error', '"./d.js"'],
    ]);
    expect(found[0].message).toBe('An inline <wcs-state> script is evaluated from a blob: URL, against which "./fmt.js" does not resolve: the state fails to load. Import a full URL or a name the page\'s import map gives, or move the state into a file (src="./state.js")');
    expect(imports(html, 'ja')[0].message).toBe('インラインの <wcs-state> のスクリプトは blob: URL から評価されるので、"./fmt.js" は解決しません（state は読み込みに失敗します）。完全な URL か、ページの import map が与える名前を import するか、state をファイルに移してください（src="./state.js"）');
  });

  it('<wcs-guard-handler> のインラインのスクリプトでも言う', () => {
    const html = '<wcs-guard-handler><script type="module">import { a } from "../auth.js"; export default () => true;</script></wcs-guard-handler>';
    const found = imports(html);
    expect(found.map((d) => textOf(html, d))).toEqual(['"../auth.js"']);
    expect(found[0].message).toBe('An inline <wcs-guard-handler> script is evaluated from a blob: URL, against which "../auth.js" does not resolve: the guard fails to load. Import a full URL or a name the page\'s import map gives');
  });

  it('完全な URL・裸の指定子（import map）・// で始まる URL・動的 import・src= の state ファイルは言わない', () => {
    const html = `<wcs-state><script type="module">
import { a } from "https://esm.run/a";
import b from "@app/b";
import c from "//cdn.example/c.js";
const d = () => import("./d.js");
export default { x: 1 };
</script></wcs-state>`;
    expect(imports(html)).toEqual([]);
    const files = { './s.js': 'import { f } from "./f.js";\nexport default { x: 1 };\n', './f.js': 'export const f = 1;\n' };
    expect(imports('<wcs-state src="./s.js"></wcs-state>', 'en', files)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('8. wcs/key-binding — key:（React の key）', () => {
  const keys = (html: string, locale = 'en'): WcsDiagnostic[] => ofCode(validate(html, locale), WcsDiagnosticCode.KeyBinding);

  it('ネイティブ要素の key: を warning にし、範囲は左辺', () => {
    const html = page(row('<span data-wcs="key: .id; textContent: .name"></span>'));
    const found = keys(html);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['warning', 'key']]);
    expect(found[0].message).toBe('"key:" sets a property named "key" and does nothing else. No key is needed: rows are matched by the row object, and $listKeys keeps rows across refetched data');
    expect(keys(html, 'ja')[0].message).toBe('"key:" は "key" という名前のプロパティを書くだけで、ほかに何もしません。key は要りません — 行は行のオブジェクトで突き合わされ、取り直したデータで行を保つのは $listKeys です');
  });

  it('カスタム要素の key:（<wcs-storage> の入力）・attr.key: は言わない', () => {
    expect(keys(page('<wcs-storage data-wcs="key: title; value#init=element: kind"></wcs-storage><p data-wcs="attr.key: title"></p>'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('9. --strict — state をまるごと読めなかった info を warning と同じく数える', () => {
  const run = (text: string, strict: boolean, errorsOnly = false) =>
    runValidation([{ source: 'index.html', text, kind: 'html', fileReader: () => undefined }], { locale: 'en', strict, errorsOnly });

  it('読めない src（wcs/state-src-unread）だけのページ: --strict なしは exit 0、ありは exit 1 で、そう言う', () => {
    const html = '<wcs-state src="/app/state.js"></wcs-state><p data-wcs="textContent: title"></p>';
    const lax = run(html, false);
    expect([lax.exitCode, lax.warningCount, lax.uncheckedCount]).toEqual([0, 0, 1]);
    expect(lax.notes.some((n) => n.startsWith('strict:'))).toBe(false);
    const strict = run(html, true);
    expect([strict.exitCode, strict.warningCount, strict.infoCount, strict.uncheckedCount]).toEqual([1, 0, 1, 1]);
    expect(strict.notes[0]).toBe('strict: 1 info about a state that was not read at all (an unread src, a spread at the top of the state) counted like warnings — give --root, or a stateSchema, to have it checked');
    // severity は変えない（info のまま）。--errors-only でも、strict が数えた行は表示する
    expect(strict.lines[0]).toMatch(/ info wcs\/state-src-unread /);
    expect(run(html, true, true).lines).toHaveLength(1);
    expect(run(html, false, true).lines).toHaveLength(0);
  });

  it('スプレッドの state（wcs/path-dynamic-unknown）も数える。ほかの info（wcs/template-syntax の FOUC）は数えない', () => {
    const spread = page('<p data-wcs="textContent: title"></p>', `  ...base,\n  title: "a",`).replace('export default', 'const base = make();\nexport default');
    const spreadResult = run(spread, true);
    expect([spreadResult.exitCode, spreadResult.warningCount, spreadResult.uncheckedCount]).toEqual([1, 0, 1]);
    // a key whose value the lint cannot read: the rest of the state is checked, so --strict passes it (as before 4.30)
    const opaque = page('<p data-wcs="textContent: team.name"></p>', `  team: init.team,`).replace('export default', 'const init = load();\nexport default');
    const opaqueResult = run(opaque, true);
    expect(opaqueResult.lines.some((l) => l.includes('wcs/path-dynamic-unknown'))).toBe(true);
    expect([opaqueResult.exitCode, opaqueResult.warningCount, opaqueResult.uncheckedCount]).toEqual([0, 0, 0]);
    const fouc = page('<p>{{ title }}</p>');
    const result = run(fouc, true);
    expect([result.exitCode, result.infoCount, result.uncheckedCount]).toEqual([0, 1, 0]);
  });
});

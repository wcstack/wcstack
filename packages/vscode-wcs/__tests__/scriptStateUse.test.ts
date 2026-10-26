/**
 * scriptStateUse.test.ts — 7GUIs の評価（@wcstack/state 4.2.0）で、実行時も lint も黙っていた、または汎用の TypeError
 * だけだった形の lint 規則。
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { WcsDiagnosticCode } from '../src/core/diagnostics.js';

const page = (state: string, markup = '') => `<wcs-state><script type="module">export default {\n${state}\n};</script></wcs-state>${markup}`;
const find = (html: string, code: string) => validateDocument(html, { locale: 'en' }).filter((d) => d.code === code);
const texts = (html: string, code: string) => find(html, code).map((d) => html.slice(d.start, d.end));

describe('wcs/token-undeclared — スクリプトの $command.<名前> を $commandTokens と照合する（No. 20）', () => {
  it('宣言に無い名前は error で、近い名前を示す（this からも、$on のハンドラの state からも）', () => {
    const html = page(`$commandTokens: ["listMove"],
  $eventTokens: ["key"],
  move() { this.$command.listMvoe.emit(1); },
  $on: { key(state) { state.$command.lsitMove.emit(2); } },`, `<ul data-wcs="command.scrollTo: $command.listMove"></ul>`);
    const found = find(html, WcsDiagnosticCode.TokenUndeclared);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['listMvoe', 'lsitMove']);
    expect(found.every((d) => d.severity === 'error')).toBe(true);
    expect(found[0].message).toContain('Did you mean "listMove"?');
  });

  it('宣言した名前・$commandTokens が読めない（無い）state・コメントと文字列の中は黙る', () => {
    expect(find(page(`$commandTokens: ["a"],\n  go() { this.$command.a.emit(); },`, `<i data-wcs="command.focus: $command.a"></i>`), WcsDiagnosticCode.TokenUndeclared)).toEqual([]);
    expect(find(page(`go() { this.$command.a.emit(); },`), WcsDiagnosticCode.TokenUndeclared)).toEqual([]);
    expect(find(page(`$commandTokens: ["a"],\n  go() { /* this.$command.b */ const s = "this.$command.c"; this.$command.a.emit(); },`, `<i data-wcs="command.focus: $command.a"></i>`), WcsDiagnosticCode.TokenUndeclared)).toEqual([]);
  });
});

describe('wcs/command-token-unbound — どの command. 束縛にも結ばれないトークンの emit（No. 34）', () => {
  it('スクリプトで emit するのに受け手が無ければ、最初の emit の名前に warning', () => {
    const html = page(`$commandTokens: ["focusEditor", "placeCaret"],
  $renderedCallback() { this.$command.focusEditor.emit(); this.$command.placeCaret.emit(0, 0); this.$command.focusEditor.emit(); },`,
    `<template data-wcs="if: editing"><input data-wcs="command.focus: $command.focusEditor"></template>`);
    const found = find(html, WcsDiagnosticCode.CommandTokenUnbound);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['placeCaret']);
    expect(found[0].severity).toBe('warning');
    expect(found[0].message).toContain('"$command.placeCaret" is emitted, but no command.<method>: $command.placeCaret binding');
  });

  it('マークアップの on*: で emit するのに受け手が無ければ、その束縛に warning', () => {
    const html = page(`$commandTokens: ["play"],`, `<button data-wcs="onclick: $command.play">▶</button>`);
    expect(texts(html, WcsDiagnosticCode.CommandTokenUnbound)).toEqual(['$command.play']);
  });

  it('受け手があれば（テンプレートの中でも）・emit しないトークン・ボリュームのトークンは黙る', () => {
    expect(find(page(`$commandTokens: ["a"],\n  go() { this.$command.a.emit(); },`, `<template data-wcs="for: items"><i data-wcs="command.focus: $command.a"></i></template>`), WcsDiagnosticCode.CommandTokenUnbound)).toEqual([]);
    expect(find(page(`$commandTokens: ["a"],\n  go() { const t = this.$command.a; },`), WcsDiagnosticCode.CommandTokenUnbound)).toEqual([]);
    const volume = `<wcs-state><script type="module">export default { t: 1 };</script></wcs-state>`
      + `<wcs-state mount="v"><script type="module">export default { $commandTokens: ["a"], go() { this.$command.a.emit(); } };</script></wcs-state>`;
    expect(find(volume, WcsDiagnosticCode.CommandTokenUnbound)).toEqual([]);
  });
});

describe('wcs/write-path-missing — 宣言していないキーへの書き込み（No. 19）', () => {
  it('近い宣言済みのキーがあれば warning と did-you-mean（代入・複合代入・前置の増減）', () => {
    const html = page(`selectedId: null, count: 0, label: "",
  select(e, i) { this.selectedID = i; },
  inc() { ++this.coutn; this.lable += "x"; },`);
    const found = find(html, WcsDiagnosticCode.WritePathMissing);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['selectedID', 'coutn', 'lable']);
    expect(found.every((d) => d.severity === 'warning')).toBe(true);
    expect(found[0].message).toContain('Did you mean "selectedId"?');
  });

  it('宣言したキー・近い名前の無い新しいキー・入れ子の書き込み・比較・読めない state は黙る', () => {
    expect(find(page(`selectedId: null,\n  a() { this.selectedId = 1; this.extraState = 2; if (this.selectedID === 3) {} },`), WcsDiagnosticCode.WritePathMissing)).toEqual([]);
    expect(find(page(`user: { name: "" },\n  a() { this.usre.name = "x"; },`), WcsDiagnosticCode.WritePathMissing)).toEqual([]);
    expect(find(`<wcs-state><script type="module">export default make();</script></wcs-state>`, WcsDiagnosticCode.WritePathMissing)).toEqual([]);
  });
});

describe('wcs/updated-callback-unbound — $renderedCallback の paths に state に無いパス（No. 33）', () => {
  it('近いパスがあれば報告する（行のフィールド・トップレベル）。宣言済みで未束縛のものは従来どおり', () => {
    const html = page(`items: [{ on: false }], label: "x", hidden: 1,
  $renderedCallback(paths) {
    if (paths.includes("hidden")) {}
    if (paths.includes("items.*.onn")) {}
    if (paths.includes("labell")) {}
    if (paths.includes("nothing-like-it")) {}
  },`, `<p data-wcs="textContent: label"></p><template data-wcs="for: items"><i data-wcs="class.on: .on"></i></template>`);
    const found = find(html, WcsDiagnosticCode.UpdatedCallbackUnbound);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['hidden', 'items.*.onn', 'labell']);
    expect(found[0].message).toContain('"hidden" is not bound anywhere');
    expect(found[1].message).toContain('"items.*.onn" is not a path of this state');
    expect(found[1].message).toContain('Did you mean "items.*.on"?');
    expect(found[2].message).toContain('Did you mean "label"?');
  });
});

describe('wcs/path-readonly — 書き戻す束縛が setter の無い getter を指す（No. 2）', () => {
  const STATE = `c: 0,
  get celsius() { return this.c; },
  get fahrenheit() { return this.c * 9 / 5 + 32; },
  set fahrenheit(v) { this.c = (v - 32) * 5 / 9; },
  items: [{ price: 1 }],
  get "items.*.total"() { return this["items.*.price"] * 2; },`;

  it('入力欄・select・textarea・checkbox の checked・radio: / checkbox: の束縛は error', () => {
    const html = page(STATE, `<input data-wcs="value: celsius"><select data-wcs="value: celsius"></select><textarea data-wcs="value: celsius"></textarea>`
      + `<input type="checkbox" data-wcs="checked: celsius"><input type="radio" data-wcs="radio: celsius"><input type="number" data-wcs="valueAsNumber: celsius">`
      + `<template data-wcs="for: items"><input data-wcs="value: .total"></template>`);
    const found = find(html, WcsDiagnosticCode.PathReadonly);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['celsius', 'celsius', 'celsius', 'celsius', 'celsius', 'celsius', '.total']);
    expect(found.every((d) => d.severity === 'error')).toBe(true);
    expect(found[0].message).toContain('"celsius" is a getter without a setter');
    expect(found[0].message).toContain('value#ro: celsius');
    expect(found[6].message).toContain('"items.*.total"');
  });

  it('setter のある getter・#ro（ほかの修飾子と並べても）・書き戻さない束縛・type=button・カスタム要素は黙る', () => {
    const html = page(STATE, `<input data-wcs="value: fahrenheit"><input data-wcs="value#ro: celsius"><input data-wcs="value#ro,init=none: celsius"><input data-wcs="value#init=none,ro: celsius"><p data-wcs="textContent: celsius"></p>`
      + `<input type="button" data-wcs="value: celsius"><input data-wcs="checked: celsius"><my-field data-wcs="value: celsius"></my-field>`);
    expect(find(html, WcsDiagnosticCode.PathReadonly)).toEqual([]);
  });
});

describe('wcs/getter-untracked-read — getter の中の現在時刻（No. 9）', () => {
  it('Date.now()・引数の無い new Date()・performance.now() は warning（getter ごとに最初の 1 か所）', () => {
    const html = page(`startedAt: 0,
  get elapsed() { return Date.now() - this.startedAt; },
  get today() { return new Date().toDateString(); },
  get frame() { return performance.now() + Date.now(); },`);
    const found = find(html, WcsDiagnosticCode.GetterUntrackedRead);
    expect(found.map((d) => html.slice(d.start, d.end).replace(/\s+/g, ' '))).toEqual(['Date.now(', 'new Date()', 'performance.now(']);
    expect(found[0].message).toContain('This getter reads Date.now()');
    expect(found[1].message).toContain('new Date()');
  });

  it('引数のある new Date(…)・メソッドの中・コメントと文字列の中は黙る', () => {
    const html = page(`ts: 0,
  get when() { return new Date(this.ts).toISOString(); },
  stamp() { this.ts = Date.now(); },
  get label() { /* Date.now() */ return "Date.now()"; },`);
    expect(find(html, WcsDiagnosticCode.GetterUntrackedRead)).toEqual([]);
  });
});

/**
 * scriptWrite.test.ts — getter・setter・メソッドが書くものを、本体ごとの書き込み集合として読む規則
 * （docs/script-write-checks.md）。
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { WcsDiagnosticCode } from '../src/core/diagnostics.js';

const page = (state: string, markup = '') => `<wcs-state><script type="module">export default {\n${state}\n};</script></wcs-state>${markup}`;
const find = (html: string, code: string) => validateDocument(html, { locale: 'en' }).filter((d) => d.code === code);
const texts = (html: string, code: string) => find(html, code).map((d) => html.slice(d.start, d.end));

describe('wcs/getter-write — getter の評価中の書き込み', () => {
  it('代入・複合代入・増減・$setAll・$update・値を渡す $resolve・別名を通した書き込みは error', () => {
    const html = page(`count: 0, items: [{ v: 1 }],
  get a() { this.count = 1; return 1; },
  get b() { this.count += 1; return 1; },
  get c() { ++this.count; return 1; },
  get d() { this.$setAll("items.*.v", [], 0); return 1; },
  get e() { this.$update("items.*.v", [0], (v) => v + 1); return 1; },
  get f() { this.$resolve("items.*.v", [0], 2); return 1; },
  get g() { const s = this; s["items.0.v"] = 3; return 1; },`);
    const found = find(html, WcsDiagnosticCode.GetterWrite);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual([
      'this.count', 'this.count', 'this.count', '"items.*.v"', '"items.*.v"', '"items.*.v"', 's["items.0.v"]',
    ]);
    expect(found.every((d) => d.severity === 'error')).toBe(true);
    expect(found[0].message).toBe('The getter "a" writes "count" while it is evaluated. A getter only reads: the write throws each time the getter is evaluated. Write it from a method, a setter or a $watch handler, or compute the value in a getter of its own');
  });

  it('getter が同期に呼ぶメソッド（その先のメソッドも）の書き込みは、呼び出しに error でメソッドを名指す', () => {
    const html = page(`count: 0,
  get total() { this.bump(); return 1; },
  bump() { this.inner(); },
  inner() { this.count = 1; },`);
    const found = find(html, WcsDiagnosticCode.GetterWrite);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['this.bump']);
    expect(found[0].message).toContain('writes "count" while it is evaluated (in the method "bump" it calls)');
  });

  it('入れ子の関数の中（返すハンドラ・後で走るコールバック）・オブジェクトの中への書き込み・書かないメソッドの呼び出しは黙る', () => {
    const html = page(`count: 0, user: { name: "a" },
  get handler() { return () => { this.count++; }; },
  get later() { setTimeout(() => this.bump(), 0); return 1; },
  get inside() { this.user.name = "b"; return 1; },
  get calls() { this.read(); return 1; },
  bump() { this.count = 1; },
  read() { return this.count; },`);
    expect(find(html, WcsDiagnosticCode.GetterWrite)).toEqual([]);
  });
});

describe('wcs/path-readonly — スクリプトが setter の無い getter に書く', () => {
  it('メソッド・setter の書き込み、行の getter への $setAll、添字のパスは error', () => {
    const html = page(`a: 1, items: [{ price: 1 }], _x: 0,
  get total() { return this.a * 2; },
  get "items.*.subtotal"() { return this["items.*.price"] * 2; },
  get x() { return this._x; },
  set x(v) { this.total = v; },
  reset() { this.total = 0; this.total += 1; },
  clear() { this.$setAll("items.*.subtotal", [], 0); this["items.0.subtotal"] = 1; },
  later() { setTimeout(() => { this.total = 1; }); },`);
    const found = find(html, WcsDiagnosticCode.PathReadonly);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual([
      'this.total', 'this.total', 'this.total', '"items.*.subtotal"', 'this["items.0.subtotal"]', 'this.total',
    ]);
    expect(found.every((d) => d.severity === 'error')).toBe(true);
    expect(found[0].message).toContain('"total" is a getter without a setter, so this write throws each time it runs');
  });

  it('setter のある getter・getter の返す値の中への書き込み・トップレベルの spread がある state は黙る', () => {
    expect(find(page(`_t: 0,
  get total() { return this._t; },
  set total(v) { this._t = v; },
  reset() { this.total = 0; },`), WcsDiagnosticCode.PathReadonly)).toEqual([]);
    expect(find(page(`a: { x: 1 },
  get total() { return this.a; },
  reset() { this.total.x = 0; },`), WcsDiagnosticCode.PathReadonly)).toEqual([]);
    expect(find(page(`...mixin,
  get total() { return 1; },
  reset() { this.total = 0; },`), WcsDiagnosticCode.PathReadonly)).toEqual([]);
  });

  it('getter の中の書き込みは wcs/getter-write だけ（二重に言わない）', () => {
    const html = page(`get total() { return 1; },\n  get other() { this.total = 1; return 1; },`);
    expect(find(html, WcsDiagnosticCode.PathReadonly)).toEqual([]);
    expect(texts(html, WcsDiagnosticCode.GetterWrite)).toEqual(['this.total']);
  });
});

describe('wcs/setter-cycle — 書き合う setter', () => {
  it('自分のパスに書く setter は error（呼ぶメソッドを通しても）', () => {
    const html = page(`_n: 0, _m: 0,
  get n() { return this._n; },
  set n(v) { this.n = v; },
  get m() { return this._m; },
  set m(v) { this.store(v); },
  store(v) { this.m = v; },`);
    const found = find(html, WcsDiagnosticCode.SetterCycle);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['n', 'm']);
    expect(found.every((d) => d.severity === 'error')).toBe(true);
    expect(found[0].message).toBe('The setter of "n" writes its own path "n". A setter\'s path is the accessor itself: writing it calls the setter again, until the stack overflows. Store the value under a data path the getter reads (such as _n)');
  });

  it('互いに書く setter は、循環の全員に warning（条件で止まりうる）。wcs/setter-unobserved は重ねない', () => {
    const html = page(`a: 1,
  get x() { return this.a; },
  set x(v) { this.y = v; },
  get y() { return this.a; },
  set y(v) { if (v > 0) this.x = v - 1; },`);
    const found = find(html, WcsDiagnosticCode.SetterCycle);
    expect(found.map((d) => [html.slice(d.start, d.end), d.severity])).toEqual([['x', 'warning'], ['y', 'warning']]);
    expect(found[0].message).toContain('Setters write each other: "x" -> "y" -> "x".');
    expect(find(html, WcsDiagnosticCode.SetterUnobserved)).toEqual([]);
  });

  it('後で走る書き込み（入れ子の関数の中）・別の setter を通して読むものを書く setter は黙る', () => {
    expect(find(page(`_n: 0,
  get n() { return this._n; },
  set n(v) { queueMicrotask(() => { this.n = v; }); },`), WcsDiagnosticCode.SetterCycle)).toEqual([]);
    expect(find(page(`_v: 0,
  get a() { return this._v; },
  set a(v) { this.b = v; },
  get b() { return this._v; },
  set b(v) { this._v = v; },`), WcsDiagnosticCode.SetterCycle)).toEqual([]);
  });
});

describe('wcs/setter-unobserved — getter が読まないものを書く setter', () => {
  it('setter の書き込みのどれも getter が読まなければ、setter の名前に warning', () => {
    const html = page(`f: 32, c: 0, items: [{ f: 1, c: 0 }],
  get celsius() { return (this.f - 32) * 5 / 9; },
  set celsius(v) { this.c = v; },
  get "items.*.celsius"() { return this["items.*.f"]; },
  set "items.*.celsius"(v) { this["items.*.c"] = v; },`, `<input data-wcs="value: celsius">`);
    const found = find(html, WcsDiagnosticCode.SetterUnobserved);
    expect(found.map((d) => [html.slice(d.start, d.end), d.severity])).toEqual([['celsius', 'warning'], ['items.*.celsius', 'warning']]);
    expect(found[0].message).toBe('The setter of "celsius" writes "c", none of which the getter "celsius" reads. After a write the getter returns its old value, and a two-way input bound to "celsius" goes back to it. Write what the getter reads, or read what the setter writes in the getter');
  });

  it('読むもの・その下・その上・getter やメソッドや $untracked を通して読むもの・別の setter を通して書くものは黙る', () => {
    const html = page(`f: 32, user: { name: "a" }, names: { first: "x" }, base: 1, k: 0, u: 0, v: 0,
  get celsius() { return (this.f - 32) * 5 / 9; },
  set celsius(v) { this.f = v * 9 / 5 + 32; },
  get name() { return this.user.name; },
  set name(v) { this["user.name"] = v; },
  get first() { return this["names.first"]; },
  set first(v) { this.names = { first: v }; },
  get doubled() { return this.base * 2; },
  get label() { return "#" + this.doubled; },
  set label(v) { this.base = Number(v); },
  get viaMethod() { return this.readK(); },
  set viaMethod(v) { this.k = v; },
  readK() { return this.k; },
  get quiet() { return this.$untracked(() => this.u); },
  set quiet(v) { this.u = v; },
  get chained() { return this.v; },
  set chained(v) { this.inner = v; },
  get inner() { return this.v; },
  set inner(v) { this.v = v; },`);
    expect(find(html, WcsDiagnosticCode.SetterUnobserved)).toEqual([]);
  });

  it('何も書かない setter・何も読まない getter・追えない読み書き（this[key]・fn(this)・知らないメソッド）は黙る', () => {
    const html = page(`store: 1, log: [], keyName: "a",
  get saved() { return this.store; },
  set saved(v) { if (v != null) localStorage.setItem("k", v); },
  get constant() { return localStorage.getItem("k"); },
  set constant(v) { this.log = [v]; },
  get dyn() { return this[this.keyName]; },
  set dyn(v) { this.log = [v]; },
  get dynWrite() { return this.store; },
  set dynWrite(v) { this[this.keyName] = v; },
  get handed() { return this.store; },
  set handed(v) { save(this, v); },
  get unknown() { return this.store; },
  set unknown(v) { this.helpers(v); },`);
    expect(find(html, WcsDiagnosticCode.SetterUnobserved)).toEqual([]);
  });

  it('getter の無い setter・パースできない本体には黙る', () => {
    expect(find(page(`log: [],\n  set sink(v) { this.log = [v]; },`), WcsDiagnosticCode.SetterUnobserved)).toEqual([]);
  });
});

/**
 * lendingDeskLint.test.ts — 継ぎ目アプリ lending-desk（TypeScript で書くチーム、4.25.0）で見つかった lint の穴（4.26）。
 *
 *   - T1: `.ts` の state の戻りの型注釈（`get t(): number {`・`m(): void {`・`$watch` の `count(cur: number): void {`）で
 *     メンバーが読めず、偽の path-missing / path-nonexistent、引数の `cur:` をキーと読む、スクリプトの規則が getter を
 *     飛ばす。本体の TypeScript の構文（`as`・`!`・型付きの局所変数）は型を消して読む（typeErasure.ts）
 *   - T2: `wcs/watch-path-missing` が stateSchema を見る
 *   - T3: JSDoc の `import("./api.ts").Name` を辿る（読めなければ「分からない」）。`cond ? X : []` の行は分からない
 *   - T4: `.ts` のモジュールが定義する要素（`as const satisfies`）
 *   - T5: `wcs/filter-input-type` が行のフィールド・stateSchema の型を使う（日付のフィルタは Date だけ）
 *   - T6: `wcs/filter-arg-enum` — `status|eq('aproved')`
 *   - T7: manifest の `stateSource` で stateSchema を当てるページを絞る
 *   - T8: `wcs/drift-state-key` — 古い stateSchema
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateDocument } from '../src/core/validateDocument.js';
import { runValidation } from '../src/core/cli/runValidation.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics.js';
import {
  analyzeCallableBodies, analyzeDeclarationSpans, analyzeOnHandlerSources, analyzeStatePaths, analyzeTopLevelStateKeys,
  analyzeWatchEntries, analyzeWatchHandlerSources,
} from '../src/service/stateAnalyzer.js';
import { eraseTypeScript, parseErasingTypes } from '../src/service/typeErasure.js';
import { resolveImportedTypes } from '../src/service/typeImports.js';
import { jsDocLiteralValues, jsDocTypeHint, parseJsDocType } from '../src/service/jsdocType.js';
import { applicationStateSourceOf, schemaAppliesToPage, stateSourceFromPage } from '../src/core/sidecar/discover.js';
import { loadManifest } from '../src/core/sidecar/loader.js';
import { validateManifestArtifact, validateManifestSet } from '../src/core/sidecar/validate.js';
import { collectPageElementContracts } from '../src/service/pageElements.js';
import { DATE_VALUE_FILTERS } from '../src/service/bindingValidator.js';
import { onHandlerStateParam } from '../src/service/semanticValidator.js';
import { collectGetterReads, readsEventCurrentTarget } from '../src/service/scriptAst.js';
import type { JsonSchemaNode } from '../src/core/sidecar/types.js';

const reader = (files: Record<string, string>) => (p: string): string | undefined => files[p.replace(/^\.\//, '')];
const validate = (html: string, files: Record<string, string> = {}, schema?: JsonSchemaNode, locale = 'en'): WcsDiagnostic[] =>
  validateDocument(html, { locale, fileReader: reader(files), ...(schema !== undefined ? { applicationSchema: schema } : {}) });
const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const textOf = (html: string, d: WcsDiagnostic): string => html.slice(d.start, d.end);
const inline = (script: string, body = ''): string => `<wcs-state><script type="module">
${script}
</script></wcs-state>
${body}`;
const manifest = (schema: JsonSchemaNode, extra: Record<string, unknown> = {}): string => JSON.stringify({
  schemaVersion: 2,
  kind: 'application',
  manifestExtensions: { 'wcstack.application': { version: 2, stateSchema: schema, ...extra } },
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================
// T1
// ============================================================

describe('T1 .ts の state の戻りの型注釈 — メンバーを読む', () => {
  const STATE = `export default defineState({
  count: 0,
  get t(): number { return this.count; },
  get o(): { a: number; b: { c: string } } { return { a: 1, b: { c: "" } }; },
  get u(): Item[] | { a: 1 } { return []; },
  get f(): () => { a: 1 } { return () => ({ a: 1 }); },
  get s(): "x" | "{" { return "x"; },
  m(): void { this.count++; },
  async load(id: number): Promise<{ id: number }> { return { id }; },
  pick<T extends { id: number }>(x: T): T { return x; },
  isA(v: unknown): v is { kind: "a" } { return true; },
  arr(): Array<{ k: string }> { return []; },
});`;

  it('get / メソッド / async / 型引数 / オブジェクト型・合併・関数型・文字列リテラル型・型述語の戻りを読み、本体を切り出すこと', () => {
    const bodies = analyzeCallableBodies(STATE);
    expect(bodies.map((b) => [b.name, b.kind])).toEqual([
      ['t', 'getter'], ['o', 'getter'], ['u', 'getter'], ['f', 'getter'], ['s', 'getter'],
      ['m', 'method'], ['load', 'method'], ['pick', 'method'], ['isA', 'method'], ['arr', 'method'],
    ]);
    expect(bodies.find((b) => b.name === 'o')!.body.trim()).toBe('return { a: 1, b: { c: "" } };');
    expect(bodies.find((b) => b.name === 'f')!.body.trim()).toBe('return () => ({ a: 1 });');
    expect(bodies.find((b) => b.name === 'load')!.params).toBe('id: number');
    expect(bodies.find((b) => b.name === 'pick')!.params).toBe('x: T');
    // 型注釈の中のキー（`a:` `c:` `kind:`）をデータのキーと読まない
    expect(analyzeDeclarationSpans(STATE).map((s) => s.name)).toEqual(['count', 't', 'o', 'u', 'f', 's', 'm', 'load', 'pick', 'isA', 'arr']);
    expect(analyzeStatePaths(STATE).find((p) => p.path === 'm')?.kind).toBe('method');
  });

  it('$watch のハンドラの引数の型（count(cur: number): void）をキーと読まないこと', () => {
    const script = `export default { count: 0, label: "", $watch: { count(cur: number, prev?: number): void { void cur; }, "label"(v: string) {} } };`;
    expect(analyzeWatchEntries(script).map((e) => e.key)).toEqual(['count', 'label']);
    expect(analyzeWatchHandlerSources(script).map((h) => [h.name, h.params])).toEqual([['count', 'cur: number, prev?: number'], ['label', 'v: string']]);
    expect(ofCode(validate(inline(script)), WcsDiagnosticCode.WatchPathMissing)).toEqual([]);
  });

  it('$on のハンドラの state 引数は、戻りの型があっても読めること（wcs/on-handler-this）', () => {
    const script = `export default { n: 0, $eventTokens: ["saved"], $on: { saved(state: S, e: Event): void { this.n = 1; } } };`;
    const [handler] = analyzeOnHandlerSources(script);
    expect(onHandlerStateParam(script, handler)).toBe('state');
    expect(ofCode(validate(inline(script, '<x-a data-wcs="eventToken.done: saved"></x-a>')), WcsDiagnosticCode.OnHandlerThis)).toHaveLength(1);
  });

  it('呼び出しの引数（spread の中の make({ a: 1 })）をメソッドと読まず、その中のキーも読まないこと', () => {
    expect(analyzeDeclarationSpans('export default { ...make({ a: 1 }), b: 2 };').map((s) => s.name)).toEqual(['b']);
    expect(analyzeDeclarationSpans('export default { m(): ', ).map((s) => s.name)).toEqual([]);
    expect(analyzeDeclarationSpans('export default { m(): X; }').map((s) => s.name)).toEqual([]);
    expect(analyzeDeclarationSpans('export default { m(): (a, b }').map((s) => s.name)).toEqual([]);
    expect(analyzeDeclarationSpans('export default { m(): "x }').map((s) => s.name)).toEqual([]);
  });

  it('r1: 型付きの getter も untracked-read を報告し、型付きのメソッド・$watch のキーに偽の報告をしないこと', () => {
    const state = `import { defineState } from "@wcstack/state/define";
export default defineState({
  count: 0,
  order: { purpose: "" },
  get typed(): number { return this.count + 2; },
  get purposeCountTyped(): number { return [...this.order.purpose].length; },
  get purposeCountPlain() { return [...this.order.purpose].length; },
  incTyped(): void { this.count++; },
  $watch: { typed(cur) { void cur; } },
});`;
    const schema: JsonSchemaNode = {
      type: 'object',
      properties: {
        count: { type: 'number' }, order: { type: 'object', properties: { purpose: { type: 'string' } } },
        typed: { type: 'number' }, purposeCountTyped: { type: 'number' }, purposeCountPlain: { type: 'number' },
      },
    };
    const html = `<wcs-state src="./state.ts"></wcs-state>
<p data-wcs="textContent: typed"></p><p data-wcs="textContent: purposeCountTyped"></p><p data-wcs="textContent: purposeCountPlain"></p>
<textarea data-wcs="value: order.purpose"></textarea><button data-wcs="onclick: incTyped">b</button>`;
    const found = validate(html, { 'state.ts': state }, schema);
    expect(ofCode(found, WcsDiagnosticCode.GetterUntrackedRead).map((d) => d.origin?.startPosition.line)).toEqual([6, 7]);
    expect(ofCode(found, WcsDiagnosticCode.PathNonexistent)).toEqual([]);
    expect(ofCode(found, WcsDiagnosticCode.WatchPathMissing)).toEqual([]);
    expect(ofCode(found, WcsDiagnosticCode.BindingPathMissing)).toEqual([]);
  });

  it('本体の TypeScript の構文（as・!・型付きの局所変数）は型を消して読み、規則が走ること', () => {
    const state = `export default {
  form: { name: "" },
  get len(): number { const v: string = this.form.name as string; return v!.length; },
};`;
    const found = validate('<wcs-state src="./s.ts"></wcs-state><input data-wcs="value: form.name"><p data-wcs="textContent: len"></p>', { 's.ts': state });
    expect(ofCode(found, WcsDiagnosticCode.GetterUntrackedRead)).toHaveLength(1);
    expect(collectGetterReads('const x: number = this.a as number; return x;')?.map((r) => r.path)).toEqual(['a']);
    expect(readsEventCurrentTarget('e: Event', 'return (e.currentTarget as HTMLElement).id;')).toBe(true);
  });
});

describe('typeErasure — 位置を保って型を消す', () => {
  it('型注釈・as・satisfies・interface を同じ長さの空白にし、消せない構文（enum）・壊れた構文は null', () => {
    expect(eraseTypeScript('const a: number = 1;')).toBe('const a         = 1;');
    const src = 'interface A { x: number }\nexport const b = { x: 1 } as const satisfies A;';
    const out = eraseTypeScript(src)!;
    expect(out).toHaveLength(src.length);
    expect(out).toContain('export const b = { x: 1 }');
    expect(out).not.toContain('satisfies');
    expect(eraseTypeScript('enum E { A }')).toBeNull();
    expect(eraseTypeScript('const = ;')).toBeNull();
    // 同じテキストは覚えている
    expect(eraseTypeScript('enum E { A }')).toBeNull();
  });

  it('parseErasingTypes: JavaScript はそのまま、TypeScript は型を消して読み、どちらでもなければ元の誤りを投げること', () => {
    expect(parseErasingTypes('let x = 1;', { ecmaVersion: 'latest', sourceType: 'module' }).type).toBe('Program');
    expect(parseErasingTypes('let y: string = "";', { ecmaVersion: 'latest', sourceType: 'module' }).type).toBe('Program');
    expect(() => parseErasingTypes('let z = ;', { ecmaVersion: 'latest', sourceType: 'module' })).toThrow();
  });

  it('消す道具の無い実行環境（古い Node）では null — 規則は従来どおり黙ること', () => {
    vi.spyOn(process, 'getBuiltinModule').mockReturnValue({} as never);
    expect(eraseTypeScript('const noEraser: number = 2;')).toBeNull();
  });

  it('Node の ExperimentalWarning は消している間だけ止め、ほかの warning は通すこと。長さの変わる結果は使わない', () => {
    const emitted: unknown[] = [];
    vi.spyOn(process, 'emitWarning').mockImplementation(((w: unknown) => { emitted.push(w); }) as never);
    vi.spyOn(process, 'getBuiltinModule').mockReturnValue({
      stripTypeScriptTypes: (code: string) => {
        process.emitWarning('stripTypeScriptTypes is an experimental feature', 'ExperimentalWarning');
        process.emitWarning(Object.assign(new Error('Type Stripping is experimental'), { name: 'ExperimentalWarning' }));
        process.emitWarning('something else', { type: 'DeprecationWarning' } as never);
        return code.includes('short') ? 'x' : code;
      },
    } as never);
    expect(eraseTypeScript('const quiet = 1;')).toBe('const quiet = 1;');
    expect(emitted).toEqual(['something else']);
    expect(eraseTypeScript('const short = 1;')).toBeNull();
  });
});

// ============================================================
// T2
// ============================================================

describe('T2 wcs/watch-path-missing は stateSchema を見る', () => {
  const schema: JsonSchemaNode = { type: 'object', properties: { count: { type: 'number' }, typed: { type: 'number' } } };

  it('schema にあるキーは報告せず、schema が確かに持たないキーだけを warning にすること', () => {
    const html = inline('export default { count: 0, $watch: { typed() {}, nope() {} } };');
    const found = ofCode(validate(html, {}, schema), WcsDiagnosticCode.WatchPathMissing);
    expect(found.map((d) => [textOf(html, d), d.severity])).toEqual([['nope', 'warning']]);
  });

  it('読めない state（spread）でも schema が決めること（schema が無ければ黙る）', () => {
    const html = inline('export default { ...base(), $watch: { typed() {}, nope() {} } };');
    expect(ofCode(validate(html, {}, schema), WcsDiagnosticCode.WatchPathMissing).map((d) => textOf(html, d))).toEqual(['nope']);
    expect(ofCode(validate(html), WcsDiagnosticCode.WatchPathMissing)).toEqual([]);
  });
});

// ============================================================
// T3
// ============================================================

const API = `/** the API's types */
export type Status = "pending" | "approved" | "denied";
export interface Line { itemId: number; from: string; quantity: number; }
interface Base {
  readonly id: number
  // a comment between members
  createdAt: Date
}
export interface Reservation extends Base {
  status: Status;
  lines: Line[];
  decidedBy?: import("./user.ts").User;
  meta: Page<Line>;
  toString(): string;
}
export type { Model } from "./model.ts";
export * from "./more.ts";
`;
const FILES: Record<string, string> = {
  'api.ts': API,
  'user.ts': 'export interface User { id: string; name: string }',
  'model.ts': 'export interface Model { code: string; children: Model[] }',
  'more.ts': 'export type Extra = { note: string };',
  'types.js': '/** @typedef {{ id: number, label: string }} Item */\nexport {};',
  'only.d.ts': 'export interface Decl { x: number }',
  'shared/api.ts': 'export interface Row { at: string; count: number }',
};

describe('T3a JSDoc の import("./x.ts").Name を辿る', () => {
  it('interface（extends・readonly・コメント・メソッドの宣言）と type を読み、行のフィールドを検査すること', () => {
    const html = inline(`export default {
  /** @type {import("./api.ts").Reservation[]} */
  list: [],
  /** @returns {import('./api.ts').Reservation[]} */
  get viaImport() { return this.list; },
};`, `<template data-wcs="for: list"><p data-wcs="textContent: .status; title: .id"></p><i data-wcs="textContent: .lines.0.quantity"></i><b data-wcs="textContent: .decidedBy.name"></b><s data-wcs="textContent: .stauts"></s><u data-wcs="textContent: .meta.anything"></u></template>
<template data-wcs="for: viaImport"><p data-wcs="textContent: .status"></p><s data-wcs="textContent: .createdAt"></s></template>`);
    const found = validate(html, FILES);
    expect(ofCode(found, WcsDiagnosticCode.BindingPathMissing).map((d) => textOf(html, d))).toEqual(['.stauts']);
    expect(ofCode(found, WcsDiagnosticCode.PathDynamicUnknown)).toEqual([]);
  });

  it('読めない型（ファイルが無い・宣言されていない名前）の下は「分からない」— info を 1 回、missing は出さないこと', () => {
    const html = inline(`export default {
  /** @type {import("./missing.ts").Row[]} */
  rows: [],
  /** @returns {import("./api.ts").Nope | null} */
  get one() { return null; },
};`, '<template data-wcs="for: rows"><p data-wcs="textContent: .at"></p></template><p data-wcs="textContent: one.x"></p>');
    const found = validate(html, FILES);
    expect(ofCode(found, WcsDiagnosticCode.BindingPathMissing)).toEqual([]);
    const infos = ofCode(found, WcsDiagnosticCode.PathDynamicUnknown);
    expect(infos.map((d) => textOf(html, d))).toEqual(['rows', 'one']);
    expect(infos[0].message).toBe('The JSDoc type import("./missing.ts").Row[] of "rows" cannot be read, so the path bound under it is not checked (read are an export interface / export type of a file it can read, and a @typedef in a .js). Write the shape in place, make it a @typedef in the same script, or declare it in the stateSchema of wcstack.manifest.json to have them checked');
    expect(ofCode(validate(html, FILES, undefined, 'ja'), WcsDiagnosticCode.PathDynamicUnknown)[0].message).toContain('"rows" の JSDoc の型 import("./missing.ts").Row[] は読めないので');
  });

  it('.js の @typedef・.js の指定で読む .d.ts・拡張子の無い指定・再 export・export * ・@typedef が名指す型を読むこと', () => {
    const types = resolveImportedTypes(`/** @typedef {import("./shared/api").Row} Row */
/** @type {import("./types.js").Item} */ /** @type {import("./only.js").Decl} */
/** @type {import("./api.ts").Model} */ /** @type {import("./api.ts").Extra} */ /** @type {import("./api.ts").Status} */`,
    { fileReader: reader(FILES), path: '' });
    expect([...types.keys()].sort()).toEqual([
      'import("./api.ts").Extra', 'import("./api.ts").Model', 'import("./api.ts").Status', 'import("./only.js").Decl',
      'import("./shared/api").Row', 'import("./types.js").Item',
    ]);
    expect(jsDocLiteralValues(types.get('import("./api.ts").Status')!, new Map())).toEqual(['pending', 'approved', 'denied']);
    // 自分を名指す型（木）は 2 段目から開いている（回り続けない）
    const model = types.get('import("./api.ts").Model')!;
    expect(model.kind).toBe('object');
    expect(resolveImportedTypes('/** @type {import("./api.ts").Model} */', undefined).size).toBe(0);
    expect(resolveImportedTypes('/** @type {import("https://x/y.ts").Model} */', { fileReader: reader(FILES), path: '' }).size).toBe(0);
  });

  it('型引数・総称の extends・改行で続く type・関数型・入れ子の宣言・別名の import を読み、読めない宣言は飛ばすこと', () => {
    const files = {
      'lib.ts': `import type { Base as B, "x" as y } from "./base.ts";
import { type Other } from "./base.ts";
export interface Page<T extends { id: number } = { id: number }> extends B<T>, Other { items: T[]; total: number }
export type Kind =
  | "a"
  | "b"
export type Fn = (x: number) => { a: 1 };
export type Plain = { k: string }
namespace N { export interface Hidden { h: number } }
interface NoBody
type NoEq;
export interface Broken { a: }
export type Pair = [string, number];
export type Ref = Page<string>;
`,
      'base.ts': 'export interface Base<T> { base: T }\nexport interface Other { other: string }',
    };
    const types = resolveImportedTypes(`/** @type {import("./lib.ts").Page} */ /** @type {import("./lib.ts").Kind} */
/** @type {import("./lib.ts").Fn} */ /** @type {import("./lib.ts").Plain} */ /** @type {import("./lib.ts").Hidden} */
/** @type {import("./lib.ts").NoBody} */ /** @type {import("./lib.ts").NoEq} */ /** @type {import("./lib.ts").Broken} */
/** @type {import("./lib.ts").Pair} */ /** @type {import("./lib.ts").Ref} */ /** @type {import("./lib.ts").y} */`,
    { fileReader: reader(files), path: '' });
    expect([...types.keys()].map((k) => k.replace('import("./lib.ts").', '')).sort()).toEqual(['Fn', 'Kind', 'Page', 'Plain', 'Ref']);
    // (a tuple is not read: `Pair` stays a type it cannot read — its key's paths are unknown, said once)
    expect(jsDocLiteralValues(types.get('import("./lib.ts").Kind')!, new Map())).toEqual(['a', 'b']);
    // the bases' members join the interface's (a union of the parts, read for its fields)
    const page = types.get('import("./lib.ts").Page')!;
    expect(page.kind).toBe('union');
    // a function type and a generic it does not know are open below
    expect(types.get('import("./lib.ts").Fn')).toEqual({ kind: 'object', fields: [], index: { kind: 'unknown' } });
  });

  it('JSDoc のリテラル型・import 型の解析（パーサ）', () => {
    expect(parseJsDocType('"a" | 1 | true | null')).toEqual({ kind: 'union', members: [
      { kind: 'literal', value: 'a' }, { kind: 'literal', value: 1 }, { kind: 'literal', value: true }, { kind: 'name', name: 'null' },
    ] });
    expect(jsDocTypeHint(parseJsDocType('"a" | "b"')!)).toBe('string');
    expect(jsDocLiteralValues(parseJsDocType('"a" | null')!, new Map())).toEqual(['a', null]);
    expect(jsDocLiteralValues(parseJsDocType('null')!, new Map())).toBeNull();
    expect(jsDocLiteralValues(parseJsDocType('"a" | string')!, new Map())).toBeNull();
    expect(parseJsDocType("import('./x').A.B[]")).toEqual({ kind: 'array', element: { kind: 'name', name: 'import("./x").A.B' } });
    expect(parseJsDocType('import("./x")')).toEqual({ kind: 'unknown' });
    expect(parseJsDocType('import(x).A')).toBeNull();
    expect(parseJsDocType('{ readonly a: number\n b?: string; readonly [k: string]: number }')).toEqual({
      kind: 'object', fields: [{ name: 'a', type: { kind: 'name', name: 'number' } }, { name: 'b', type: { kind: 'name', name: 'string' } }],
      index: { kind: 'name', name: 'number' },
    });
    expect(parseJsDocType('{ m(): void; a: number }', { typescript: true })).toEqual({ kind: 'object', fields: [{ name: 'a', type: { kind: 'name', name: 'number' } }] });
    expect(parseJsDocType('{ m(: void', { typescript: true })).toBeNull();
  });

  it('wcs/type-annotation: リテラル型は値の型で比べ、読めない別モジュールの型は検査しないこと', () => {
    const html = inline(`export default {
  /** @type {"a" | "b"} */ mode: 1,
  /** @type {"a" | "b"} */ ok: "a",
  /** @type {import("./api.ts").Status} */ status: "pending",
};`);
    expect(ofCode(validate(html), WcsDiagnosticCode.TypeAnnotation).map((d) => textOf(html, d))).toEqual(['1']);
  });
});

describe('T3b cond ? X : [] の getter — X の形が分からなければ行は「分からない」', () => {
  const body = (getter: string): string => inline(`export default {
  result: load(),
  items: [{ id: 1 }],
  get counter() { return this.result; },
  ${getter}
  get "pickups.*.time"() { return ""; },
};`, '<template data-wcs="for: pickups"><p data-wcs="textContent: .groupName; title: .time"></p></template>');

  for (const getter of [
    'get pickups() { return this.counter ? this.counter.pickups : []; },',
    'get pickups() { return this.counter?.pickups ?? []; },',
    'get pickups() { return compute(this.counter) || []; },',
    'get pickups() { if (!this.counter) return []; return this.counter.pickups; },',
  ]) {
    it(`行のフィールドを missing にせず、getter に info を 1 回出すこと: ${getter}`, () => {
      const html = body(getter);
      const found = validate(html);
      expect(ofCode(found, WcsDiagnosticCode.BindingPathMissing)).toEqual([]);
      expect(ofCode(found, WcsDiagnosticCode.PathDynamicUnknown).map((d) => textOf(html, d))).toEqual(['pickups']);
    });
  }

  it('行の形が分かるリスト（this.items ?? []）・JSDoc で型を付けた getter の行は今までどおり検査すること', () => {
    const html = inline(`export default {
  items: [{ id: 1 }],
  get a() { return this.items ?? []; },
  /** @returns {{ id: number }[]} */
  get b() { return this.x ? this.x.rows : []; },
};`, '<template data-wcs="for: a"><p data-wcs="textContent: .idd"></p></template><template data-wcs="for: b"><p data-wcs="textContent: .idd"></p></template>');
    expect(ofCode(validate(html), WcsDiagnosticCode.BindingPathMissing).map((d) => textOf(html, d))).toEqual(['.idd', '.idd']);
  });
});

// ============================================================
// T4
// ============================================================

describe('T4 .ts のモジュールが定義する要素', () => {
  const PLAIN = `export class QtyPlain extends HTMLElement {
  static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "value", event: "qty:change" }], inputs: [{ name: "value" }, { name: "max" }] };
  value: number = 0;
}
customElements.define("qty-plain", QtyPlain);`;
  const SAT = `type Decl = { protocol: "wc-bindable"; version: number; properties: readonly { name: string; event: string }[]; inputs: readonly { name: string }[] };
export class QtySat extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [{ name: "value", event: "qty:change" }],
    inputs: [{ name: "value" }, { name: "max" }],
  } as const satisfies Decl;
  private max!: number;
}
customElements.define("qty-sat", QtySat);`;
  const BODY = '<wcs-state><script type="module">export default { n: 1 };</script></wcs-state><qty-plain data-wcs="maximum: n"></qty-plain><qty-sat data-wcs="maximum: n"></qty-sat>';

  it('src= の .ts と、それが import する .ts（as const satisfies）を読み、宣言に無いメンバーを報告すること', () => {
    const html = `<script type="module" src="./main.ts"></script>${BODY}`;
    const files = { 'main.ts': 'import "./qty-plain.ts";\nimport "./qty-sat.ts";', 'qty-plain.ts': PLAIN, 'qty-sat.ts': SAT };
    expect(ofCode(validate(html, files), WcsDiagnosticCode.TagMemberUnknown).map((d) => textOf(html, d))).toEqual(['maximum', 'maximum']);
    expect([...collectPageElementContracts(html, reader(files)).keys()]).toEqual(['qty-plain', 'qty-sat']);
  });

  it('.js の指定は無ければ .ts を、拡張子の無い指定は .ts → .js を読むこと（同じファイルは 1 回）', () => {
    const html = `<script type="module" src="/src/main.ts"></script>${BODY}`;
    const files = {
      'src/main.ts': 'import "./qty-plain.js";\nimport "./qty-sat";\nimport "./qty-plain.js";\nimport "./none";',
      'src/qty-plain.ts': PLAIN, 'src/qty-sat.ts': SAT,
    };
    expect([...collectPageElementContracts(html, reader(files)).keys()].sort()).toEqual(['qty-plain', 'qty-sat']);
  });
});

// ============================================================
// T5
// ============================================================

describe('T5 wcs/filter-input-type — 行のフィールドと stateSchema の型', () => {
  it('r8: 行のリテラルの string に toFixed・date を報告し、トップレベルも今までどおり', () => {
    const html = inline(`export default {
  label: "5,000円",
  rows: [{ label: "5,000円", at: "2026-11-17T09:15", when: null }],
  /** @type {string | null} */
  maybe: null,
};`, `<p data-wcs="textContent: label|toFixed(0)"></p>
<template data-wcs="for: rows"><p data-wcs="textContent: .label|toFixed(0)"></p><p data-wcs="textContent: .at|date"></p><p data-wcs="textContent: .when|date"></p></template>
<p data-wcs="textContent: maybe|date"></p><p data-wcs="textContent: label|trim|datetime"></p>`);
    const found = ofCode(validate(html), WcsDiagnosticCode.FilterInputType);
    expect(found.map((d) => textOf(html, d))).toEqual(['toFixed', 'toFixed', 'date', 'date', 'datetime']);
    expect(found[2].message).toBe('Filter "date" requires input of type Date (current type: string)');
  });

  it('stateSchema の型（getter の行のフィールド）を使うこと（r8 の ts.html）', () => {
    const schema: JsonSchemaNode = {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'number' }, depositLabel: { type: 'string' } } } } },
    };
    const state = `type Item = { id: number; depositYen: number };
export default defineState({
  result: null as { items: Item[] } | null,
  get items(): Item[] { return this.result?.items ?? []; },
  get "items.*.depositLabel"(): string { return \`\${this["items.*.depositYen"]}円\`; },
});`;
    const html = '<wcs-state src="./state.ts"></wcs-state><template data-wcs="for: items"><p data-wcs="textContent: .depositLabel|toFixed(0); title: .id|toFixed(0)"></p></template>';
    expect(ofCode(validate(html, { 'state.ts': state }, schema), WcsDiagnosticCode.FilterInputType).map((d) => textOf(html, d))).toEqual(['toFixed']);
  });

  it('日付のフィルタの一覧は state の formats.ts の valueMustBeDate と一致すること', () => {
    const source = readFileSync(new URL('../../state/src/filters/formats.ts', import.meta.url), 'utf8');
    const names = new Set([...source.matchAll(/valueMustBeDate\('([a-z]+)'/g)].map((m) => m[1]));
    expect([...names].sort()).toEqual([...DATE_VALUE_FILTERS].sort());
  });
});

// ============================================================
// T6
// ============================================================

describe('T6 wcs/filter-arg-enum — 比較のフィルタのリテラルが取りうる値に無い', () => {
  it('JSDoc のリテラルの合併（@typedef・行のフィールド）と数の合併: 綴りの近い値を挙げること', () => {
    const html = inline(`/** @typedef {"pending" | "approved" | "denied"} Status */
export default {
  /** @type {Status} */ status: "pending",
  /** @type {{ id: number, status: Status }[]} */ rows: [],
  /** @type {1 | 2 | 3} */ level: 1,
  /** @type {boolean | null} */ flag: null,
  /** @type {true | null} */ on: null,
};`, `<p data-wcs="class.a: status|eq('aproved'); class.b: status|eq('approved'); class.c: status|ne(denied); class.d: status|ne('nope')"></p>
<template data-wcs="for: rows"><p data-wcs="class.st-approved: .status|eq('aproved')"></p></template>
<p data-wcs="class.l: level|eq(4); class.m: level|eq(2); class.n: level|eq('3'); class.f: flag|eq(true); class.o: on|eq(null); class.p: on|eq('true'); class.q: status|not|eq(x)"></p>`);
    const found = ofCode(validate(html), WcsDiagnosticCode.FilterArgEnum);
    expect(found.map((d) => [textOf(html, d), d.severity])).toEqual([
      ["'aproved'", 'warning'], ["'nope'", 'warning'], ["'aproved'", 'warning'], ['4', 'warning'], ["'true'", 'warning'],
    ]);
    expect(found[0].message).toBe(`'aproved' in "eq('aproved')" is not a value the compared value takes ('pending' | 'approved' | 'denied'): it is never true. Did you mean "approved"?`);
    expect(found[1].message).toContain('it is always true');
    expect(ofCode(validate(html, {}, undefined, 'ja'), WcsDiagnosticCode.FilterArgEnum)[0].message)
      .toBe(`"eq('aproved')" の 'aproved' は、比べる値が取りうる値（'pending' | 'approved' | 'denied'）にありません — 決して真になりません。もしかして: "approved"`);
  });

  it('stateSchema の enum・const・anyOf の const（null を含む）、入れ子と行のフィールド', () => {
    const schema: JsonSchemaNode = {
      type: 'object',
      properties: {
        status: { enum: ['pending', 'approved', 'denied'] },
        mode: { anyOf: [{ const: 'a' }, { const: 'b' }, { type: 'null' }] },
        kind: { const: 'x' },
        list: { type: 'array', items: { type: 'object', properties: { state: { $ref: '#/$defs/S' } } } },
        free: { type: 'string' },
        mixed: { anyOf: [{ const: 'a' }, { type: 'string' }] },
        deep: { enum: [{ a: 1 }] },
      },
      $defs: { S: { enum: ['open', 'closed'] } },
    };
    const html = inline('export default { status: "", mode: null, kind: "x", list: [], free: "", mixed: "", deep: null };', `<p data-wcs="class.a: status|eq('aproved'); class.b: mode|eq(c); class.c: mode|eq(null); class.d: kind|eq('x'); class.e: free|eq('z'); class.f: mixed|eq('z'); class.g: deep|eq(1)"></p>
<template data-wcs="for: list"><p data-wcs="class.o: .state|eq('opne')"></p></template>`);
    expect(ofCode(validate(html, {}, schema), WcsDiagnosticCode.FilterArgEnum).map((d) => textOf(html, d))).toEqual(["'aproved'", 'c', "'opne'"]);
  });
});

// ============================================================
// T7
// ============================================================

describe('T7 manifest の stateSource — stateSchema はその state を読むページにだけ', () => {
  const schema: JsonSchemaNode = { type: 'object', properties: { count: { type: 'number' } } };
  const withSource = manifest(schema, { stateSource: 'src/state/app.ts' });
  const STATE = 'export default { count: 0 };';
  const pageOf = (src: string): string => `<wcs-state src="${src}"></wcs-state><p data-wcs="textContent: cuont"></p>`;

  it('発見した manifest: そのファイル（.js / .ts は同じ・先頭 / はページの場所から）を読むページには当て、ほかのページには当てないこと', () => {
    const files = { 'wcstack.manifest.json': withSource, 'src/state/app.ts': STATE, 'other.js': 'export default { count: 1 };' };
    for (const src of ['src/state/app.ts', './src/state/app.js', '/src/state/app.ts', 'src/state/app.ts?v=1']) {
      expect(validate(pageOf(src), files).map((d) => d.code), src).toContain(WcsDiagnosticCode.PathNonexistent);
    }
    expect(validate(pageOf('./other.js'), files).map((d) => d.code)).toEqual([WcsDiagnosticCode.BindingPathMissing]);
    const counter = inline('export default { center: "" };', '<p data-wcs="textContent: center"></p>');
    expect(validate(counter, files)).toEqual([]);
  });

  it('stateSource の無い manifest（手書き・4.25 までの生成）は今までどおりすべてのページに当てること', () => {
    const files = { 'wcstack.manifest.json': manifest(schema), 'src/state/app.ts': STATE };
    expect(validate(pageOf('./x.js'), files).map((d) => d.code)).toContain(WcsDiagnosticCode.PathNonexistent);
  });

  it('上の階層の manifest: stateSource は manifest からの相対で、ページからの相対に直して比べること', () => {
    // (the page is in pages/: the reader reads ../pages/state.ts as ./state.ts — as the file system does)
    const files = { '../wcstack.manifest.json': manifest(schema, { stateSource: 'pages/state.ts' }), 'state.ts': STATE, '../pages/state.ts': STATE };
    expect(validate(pageOf('./state.js'), files).map((d) => d.code)).toContain(WcsDiagnosticCode.PathNonexistent);
    expect(validate(pageOf('../state.js'), { ...files, '../state.js': 'export default { count: 2 };' }).map((d) => d.code)).not.toContain(WcsDiagnosticCode.PathNonexistent);
  });

  it('CLI に渡した manifest も同じ: index.html には当て、counter.html（インラインの state）には当てないこと', () => {
    const appManifest = manifest(schema, { stateSource: 'app.ts' });
    const files = { 'src/state/app.ts': STATE };
    const index = '<wcs-state src="src/state/app.ts"></wcs-state><p data-wcs="textContent: cuont"></p>';
    const counter = inline('export default { center: "" };', '<p data-wcs="textContent: center"></p>');
    const result = runValidation([
      { source: 'index.html', text: index, kind: 'html', fileReader: reader(files) },
      { source: 'counter.html', text: counter, kind: 'html', fileReader: reader(files) },
      { source: 'src/state/app.manifest.json', text: appManifest, kind: 'manifest' },
    ], { locale: 'en' });
    expect(result.diagnosticsBySource.get('index.html')!.map((d) => d.code)).toEqual([WcsDiagnosticCode.PathNonexistent]);
    expect(result.diagnosticsBySource.get('counter.html')).toEqual([]);
    expect(result.diagnosticsBySource.get('src/state/app.manifest.json')).toEqual([]);
    // 片方が絶対パスで比べられないときは今までどおり当てる
    const mixed = runValidation([
      { source: 'counter.html', text: counter.replace('center"></p>', 'centre"></p>'), kind: 'html', fileReader: reader(files) },
      { source: 'C:/app/src/state/app.manifest.json', text: appManifest, kind: 'manifest' },
    ], { locale: 'en' });
    expect(mixed.diagnosticsBySource.get('counter.html')!.map((d) => d.code)).toContain(WcsDiagnosticCode.PathNonexistent);
  });

  it('manifest の検証は stateSource を受けつけ、読み手は文字列でなければ無いものとすること', () => {
    expect(validateManifestArtifact({ text: withSource, source: 'm.json' })).toEqual([]);
    expect(applicationStateSourceOf(loadManifest({ text: withSource, source: 'm' }))).toBe('src/state/app.ts');
    expect(applicationStateSourceOf(loadManifest({ text: manifest(schema, { stateSource: 3 }), source: 'm' }))).toBeUndefined();
    expect(applicationStateSourceOf(loadManifest({ text: manifest(schema, { stateSource: ' ' }), source: 'm' }))).toBeUndefined();
    expect(applicationStateSourceOf(loadManifest({ text: '{"schemaVersion":2,"kind":"package"}', source: 'm' }))).toBeUndefined();
    const set = validateManifestSet({ artifacts: [{ text: withSource, source: 'a/m.json' }] });
    expect([set.resolvedSchemaSource, set.resolvedStateSource]).toEqual(['a/m.json', 'src/state/app.ts']);
  });

  it('stateSourceFromPage / schemaAppliesToPage', () => {
    expect(stateSourceFromPage('index.html', 'src/state/app.manifest.json', 'app.ts')).toBe('src/state/app.ts');
    expect(stateSourceFromPage('pages/a/index.html', 'src/m.json', './state/app.ts')).toBe('../../src/state/app.ts');
    expect(stateSourceFromPage('C:\\p\\index.html', 'c:/p/src/m.json', 'app.ts')).toBe('src/app.ts');
    expect(stateSourceFromPage('/p/index.html', 'src/m.json', 'app.ts')).toBeUndefined();
    const html = (attrs: string): string => `<wcs-state ${attrs}></wcs-state>`;
    expect(schemaAppliesToPage(html('src="./a.mjs"'), 'wcs-state', 'a.mts')).toBe(true);
    expect(schemaAppliesToPage(html('src="https://x/a.ts"'), 'wcs-state', 'a.ts')).toBe(false);
    expect(schemaAppliesToPage(html('src=""'), 'wcs-state', 'a.ts')).toBe(false);
    expect(schemaAppliesToPage(html('mount="m" src="a.ts"'), 'wcs-state', 'a.ts')).toBe(false);
    expect(schemaAppliesToPage(`<template>${html('src="a.ts"')}</template>`, 'wcs-state', 'a.ts')).toBe(false);
    // 先頭 / の src は、reader が両方を同じ内容で読めても同じファイル
    const files = { '/assets/state.js': 'X', 'dist/state.js': 'X' };
    expect(schemaAppliesToPage(html('src="/assets/state.js"'), 'wcs-state', 'dist/state.js', reader(files))).toBe(true);
    expect(schemaAppliesToPage(html('src="/assets/other.js"'), 'wcs-state', 'dist/state.js', reader(files))).toBe(false);
  });
});

// ============================================================
// T8
// ============================================================

describe('T8 wcs/drift-state-key — スクリプトと食い違う stateSchema', () => {
  const schema: JsonSchemaNode = {
    type: 'object',
    properties: { headerName: { type: 'string' }, cartEmpty: { type: 'boolean' }, count: { type: 'number' }, cart: { type: 'object' } },
  };

  it('名前を変えたキー（スクリプトだけ）を両側から挙げ、<wcs-state> の上で warning を 1 回出すこと（作者の誤り #1）', () => {
    const html = inline(`export default {
  count: 0,
  get displayName() { return ""; },
  get isCartEmpty() { return true; },
  get "items.*.label"() { return ""; },
  save() {},
  $watch: {},
};`) + '<wcs-state mount="cart"><script type="module">export default { n: 1 };</script></wcs-state>';
    const found = ofCode(validate(html, {}, schema), WcsDiagnosticCode.DriftStateKey);
    expect(found.map((d) => [textOf(html, d), d.severity])).toEqual([['<wcs-state', 'warning']]);
    expect(found[0].message).toContain('(in the script, not in the schema: displayName, isCartEmpty) (in the schema, not in the script: headerName, cartEmpty)');
    expect(ofCode(validate(html, {}, schema, 'ja'), WcsDiagnosticCode.DriftStateKey)[0].message)
      .toContain('（スクリプトにあって schema に無いキー: displayName, isCartEmpty）（schema にあってスクリプトに無いキー: headerName, cartEmpty）');
  });

  it('一致していれば黙り、src= のファイルも読むこと。多すぎるキーは数で言うこと', () => {
    const ok = 'export default { headerName: "", cartEmpty: false, count: 0, cart: {} };';
    expect(ofCode(validate(inline(ok), {}, schema), WcsDiagnosticCode.DriftStateKey)).toEqual([]);
    const many = `export default { ${Array.from({ length: 12 }, (_, i) => `k${i}: 0`).join(', ')}, headerName: "", cartEmpty: false, count: 0, cart: {} };`;
    const found = ofCode(validate('<wcs-state src="./s.js"></wcs-state>', { 's.js': many }, schema), WcsDiagnosticCode.DriftStateKey);
    expect(found[0].message).toContain('k0, k1, k2, k3, k4, k5, k6, k7, k8, k9 … (+2)');
  });

  it('読み切れないスクリプト（spread・計算したキー・$stream）、JSON の state、root が 2 つ、開いた schema では黙ること', () => {
    for (const script of [
      'export default { ...base(), count: 0 };',
      'export default { [key]: 0, count: 0 };',
      'export default { get [key]() { return 0; }, count: 0 };',
      'export default { count: 0, $stream: { tick: { source: () => null } } };',
      'export default make();',
    ]) {
      expect(ofCode(validate(inline(script), {}, schema), WcsDiagnosticCode.DriftStateKey), script).toEqual([]);
    }
    expect(ofCode(validate(`<wcs-state json='{"x":1}'></wcs-state>`, {}, schema), WcsDiagnosticCode.DriftStateKey)).toEqual([]);
    expect(ofCode(validate('<wcs-state src="./s.json"></wcs-state>', { 's.json': '{"x":1}' }, schema), WcsDiagnosticCode.DriftStateKey)).toEqual([]);
    expect(ofCode(validate('<wcs-state src="./none.js"></wcs-state>', {}, schema), WcsDiagnosticCode.DriftStateKey)).toEqual([]);
    expect(ofCode(validate('<wcs-state state="x"></wcs-state>', {}, schema), WcsDiagnosticCode.DriftStateKey)).toEqual([]);
    expect(ofCode(validate(inline('export default { x: 1 };') + inline('export default { y: 1 };'), {}, schema), WcsDiagnosticCode.DriftStateKey)).toEqual([]);
    expect(ofCode(validate(inline('export default { x: 1 };'), {}, { type: 'object' }), WcsDiagnosticCode.DriftStateKey)).toEqual([]);
  });

  it('schema の $ref・anyOf の properties も読み、スクリプトのメソッドと同名の schema のキーは食い違いにすること', () => {
    const refSchema: JsonSchemaNode = { $ref: '#/$defs/Root', $defs: { Root: { anyOf: [{ type: 'object', properties: { a: {}, save: {} } }] } } };
    const html = inline('export default { a: 1, save() {} };');
    expect(ofCode(validate(html, {}, refSchema), WcsDiagnosticCode.DriftStateKey)[0].message).toContain('(in the schema, not in the script: save)');
    expect(analyzeTopLevelStateKeys('export default { a: 1, b, get c() { return 1; }, m() {}, $watch: {} };'))
      .toEqual({ keys: ['a', 'b', 'c'], methods: ['m'], materializes: false });
    expect(analyzeTopLevelStateKeys('export default { a: 1, m() {}, m() {}, a: 2 };')).toEqual({ keys: ['a'], methods: ['m'], materializes: false });
  });
});

// ============================================================
// T7b（street-reports の取り込みから。v4-direction §5.28 D）
// ============================================================

describe('T7b 生成した schema を持つアプリ 2 つを 1 回の実行で — 違う状態ファイルを名指す schema は衝突しない', () => {
  const schemaA: JsonSchemaNode = { type: 'object', properties: { count: { type: 'number' } } };
  const schemaB: JsonSchemaNode = { type: 'object', properties: { title: { type: 'string' } } };
  const pageA = '<wcs-state src="./state.js"></wcs-state><p data-wcs="textContent: count"></p><p data-wcs="textContent: cuont"></p>';
  const pageB = '<wcs-state src="./state.js"></wcs-state><p data-wcs="textContent: title"></p><p data-wcs="textContent: titel"></p>';
  const filesA = { 'state.js': 'export default { count: 0 };' };
  const filesB = { 'state.js': 'export default { title: "" };' };
  const codes = (diags: readonly WcsDiagnostic[] | undefined): string[] => (diags ?? []).map((d) => d.code);
  const nonexistent = (html: string, diags: readonly WcsDiagnostic[] | undefined): string[] =>
    ofCode(diags ?? [], WcsDiagnosticCode.PathNonexistent).map((d) => textOf(html, d));

  it('ページごとに、その root の <wcs-state src> が読むファイルの schema を当てること（衝突の error は出ない）', () => {
    const result = runValidation([
      { source: 'apps/a/index.html', text: pageA, kind: 'html', fileReader: reader(filesA) },
      { source: 'apps/b/index.html', text: pageB, kind: 'html', fileReader: reader(filesB) },
      { source: 'apps/a/wcstack.manifest.json', text: manifest(schemaA, { stateSource: 'state.ts' }), kind: 'manifest' },
      { source: 'apps/b/wcstack.manifest.json', text: manifest(schemaB, { stateSource: 'state.ts' }), kind: 'manifest' },
    ], { locale: 'en' });
    expect(nonexistent(pageA, result.diagnosticsBySource.get('apps/a/index.html'))).toEqual(['cuont']);
    expect(nonexistent(pageB, result.diagnosticsBySource.get('apps/b/index.html'))).toEqual(['titel']);
    expect(result.diagnosticsBySource.get('apps/a/wcstack.manifest.json')).toEqual([]);
    expect(result.diagnosticsBySource.get('apps/b/wcstack.manifest.json')).toEqual([]);
  });

  it('どちらのファイルも読まないページ（別の src・インラインの state）には、どちらの schema も当てないこと', () => {
    const other = '<wcs-state src="./other.js"></wcs-state><p data-wcs="textContent: count"></p>';
    const result = runValidation([
      { source: 'apps/c/index.html', text: other, kind: 'html', fileReader: reader({ 'other.js': 'export default { count: 0 };' }) },
      { source: 'apps/a/wcstack.manifest.json', text: manifest(schemaA, { stateSource: 'state.ts' }), kind: 'manifest' },
      { source: 'apps/b/wcstack.manifest.json', text: manifest(schemaB, { stateSource: 'state.ts' }), kind: 'manifest' },
    ], { locale: 'en' });
    expect(result.diagnosticsBySource.get('apps/c/index.html')).toEqual([]);
  });

  it('集合の結果: 使う schema は 2 つ、単独の resolvedSchema は無い', () => {
    const set = validateManifestSet({ artifacts: [
      { text: manifest(schemaA, { stateSource: 'state.ts' }), source: 'apps/a/wcstack.manifest.json' },
      { text: manifest(schemaB, { stateSource: 'state.ts' }), source: 'apps/b/wcstack.manifest.json' },
    ] });
    expect(set.resolvedSchemas.map((e) => [e.source, e.stateSource])).toEqual([
      ['apps/a/wcstack.manifest.json', 'state.ts'],
      ['apps/b/wcstack.manifest.json', 'state.ts'],
    ]);
    expect(set.resolvedSchema).toBeUndefined();
    expect(set.diagnostics).toEqual([]);
  });

  it('同じファイル（.ts と .js も同じ）・stateSource の無いもの・比べられない組（絶対と相対）は今までどおり衝突し、どれも使わないこと', () => {
    const cases: [string, string, string, string | undefined][] = [
      ['apps/a/x.manifest.json', 'state.ts', 'apps/a/y.manifest.json', 'state.ts'],
      ['apps/a/x.manifest.json', 'state.ts', 'apps/a/y.manifest.json', './state.js'],
      ['apps/a/x.manifest.json', 'state.ts', 'apps/b/y.manifest.json', '../a/state.ts'],
      ['apps/a/x.manifest.json', 'state.ts', 'apps/b/y.manifest.json', undefined],
      ['C:/w/apps/a/x.manifest.json', 'state.ts', 'apps/b/y.manifest.json', 'state.ts'],
    ];
    for (const [a, sa, b, sb] of cases) {
      const result = runValidation([
        { source: 'apps/a/index.html', text: pageA, kind: 'html', fileReader: reader(filesA) },
        { source: a, text: manifest(schemaA, { stateSource: sa }), kind: 'manifest' },
        { source: b, text: manifest(schemaB, sb === undefined ? {} : { stateSource: sb }), kind: 'manifest' },
      ], { locale: 'en' });
      expect(codes(result.diagnosticsBySource.get(b)), `${a} ${sa} / ${b} ${sb}`).toContain(WcsDiagnosticCode.ManifestStateCollision);
      expect(nonexistent(pageA, result.diagnosticsBySource.get('apps/a/index.html')), `${b} ${sb}`).toEqual([]);
    }
  });

  it('衝突が 1 つでもあれば、ほかと衝突しない 3 つ目の schema も使わないこと（勝者なし）', () => {
    const set = validateManifestSet({ artifacts: [
      { text: manifest(schemaA, { stateSource: 'state.ts' }), source: 'apps/a/x.manifest.json' },
      { text: manifest(schemaA, { stateSource: 'state.ts' }), source: 'apps/a/y.manifest.json' },
      { text: manifest(schemaB, { stateSource: 'state.ts' }), source: 'apps/b/wcstack.manifest.json' },
    ] });
    expect(set.resolvedSchemas).toEqual([]);
    expect(set.diagnostics.map((d) => d.code)).toEqual([WcsDiagnosticCode.ManifestStateCollision]);
  });
});

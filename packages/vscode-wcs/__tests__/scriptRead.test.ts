/**
 * scriptRead.test.ts — 確定申告の下書きツールの評価（@wcstack/state 4.2.0）: lint が検査するのは HTML のバインドの
 * パスだけで、getter の中の打ち間違いはテスト頼みだった。トップレベルの spread（`...sanitizeInputs({}).inputs`）の横に
 * getter があると、spread が持ち込むキーをすべて「存在しない」と誤って報告していた（作者はそのために manifest を書いた）。
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { WcsDiagnosticCode } from '../src/core/diagnostics.js';
import type { JsonSchemaNode } from '../src/core/sidecar/types.js';

const page = (state: string, markup = '') => `<wcs-state><script type="module">export default {\n${state}\n};</script></wcs-state>${markup}`;
const find = (html: string, code: string, applicationSchema?: JsonSchemaNode) =>
  validateDocument(html, { locale: 'en', applicationSchema }).filter((d) => d.code === code);
const texts = (html: string, code: string, applicationSchema?: JsonSchemaNode) =>
  find(html, code, applicationSchema).map((d) => html.slice(d.start, d.end));
const reader = (files: Record<string, string>) => (path: string): string | undefined => files[path];

const SCHEMA: JsonSchemaNode = {
  type: 'object',
  properties: {
    filingType: { type: 'string' },
    incomes: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, amount: { type: 'number' } } } },
    extra: {},
  },
};

describe('wcs/read-path-missing — getter・メソッドの中で読むパスが state に無い', () => {
  it('行のフィールド・$getAll のパス・トップレベルのキーの打ち間違いを、近い名前付きで warning にする', () => {
    const html = page(`items: [{ name: "a", amount: 1 }],
  total: 0,
  get "items.*.label"() { return this["items.*.nmae"]; },
  get sum() { return this.$getAll("items.*.amout", []).length + this.totl; },
  reset() { this.total = this["items.0.amount"] + this["items.0.amuont"]; },`, `<p>{{ sum }}</p>`);
    const found = find(html, WcsDiagnosticCode.ReadPathMissing);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['this["items.*.nmae"]', 'this.$getAll("items.*.amout", [])', 'this.totl', 'this["items.0.amuont"]']);
    expect(found.every((d) => d.severity === 'warning')).toBe(true);
    expect(found[0].message).toBe('Path "items.*.nmae" does not exist in the state definition. The read gives undefined, and what is computed from it is wrong without a word. Did you mean "name"?');
    expect(found[2].message).toBe('"totl" is not a key the state declares. Reading it throws (#301). Did you mean "total"?');
  });

  it('近い名前の無い任意のキー・正しいパス・実行時に作るパス・getter の値の下・$ の名前・複合代入は黙る', () => {
    const html = page(`opts: {},
  items: [{ name: "a" }],
  count: 0,
  get obj() { return make(); },
  get a() { return this["opts.flag"] ?? this["items.*.name"] ?? this.obj ?? this["obj.anything"]; },
  get b() { const key = "x"; return this[key] ?? this[\`items.\${key}\`] ?? this.$1 ?? this.$getAll(\`items.*.\${key}\`, []); },
  bump() { this.coutn++; },`, `<p>{{ a }}{{ b }}</p>`);
    expect(texts(html, WcsDiagnosticCode.ReadPathMissing)).toEqual([]);
    // the compound assignment is a write of an undeclared key (a near one: wcs/write-path-missing)
    expect(texts(html, WcsDiagnosticCode.WritePathMissing)).toEqual(['coutn']);
  });

  it('ボリュームのスクリプトはマウントパスの下で引く', () => {
    const html = `<wcs-state><script type="module">export default { title: "" };</script></wcs-state>
<wcs-state mount="cart"><script type="module">export default {
  lines: [{ qty: 1 }],
  get count() { return this.$getAll("lines.*.qyt", []).length + this.$getAll("lines.*.qty", []).length; },
};</script></wcs-state><p>{{ cart.count }}</p>`;
    expect(texts(html, WcsDiagnosticCode.ReadPathMissing)).toEqual(['this.$getAll("lines.*.qyt", [])']);
  });

  it('stateSchema があれば、spread の state でも schema で引き、無いと言い切れるものは error にする（unknown の下は黙る）', () => {
    const html = page(`...load(),
  get total() { return this.$getAll("incomes.*.amout", []).length + this.filingTyp.length + this["extra.anything"]; },`, `<p>{{ total }}</p>`);
    const found = find(html, WcsDiagnosticCode.ReadPathMissing, SCHEMA);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['this.$getAll("incomes.*.amout", [])', 'this.filingTyp']);
    expect(found.every((d) => d.severity === 'error')).toBe(true);
    expect(find(html, WcsDiagnosticCode.PathDynamicUnknown, SCHEMA)).toEqual([]);
  });

  it('src= の state はファイルの中の位置で報告する', () => {
    const state = 'export default {\n  items: [{ amount: 1 }],\n  get sum() { return this["items.*.amout"]; },\n};\n';
    const html = '<wcs-state src="./state.js"></wcs-state><p>{{ sum }}</p>';
    const found = validateDocument(html, { locale: 'en', fileReader: reader({ './state.js': state }) }).filter((d) => d.code === WcsDiagnosticCode.ReadPathMissing);
    expect(found).toHaveLength(1);
    expect(found[0].origin?.path).toBe('./state.js');
    expect(state.slice(found[0].origin!.start, found[0].origin!.end)).toBe('this["items.*.amout"]');
  });
});

describe('トップレベルの spread（wcs/path-dynamic-unknown — lint の限界の告知）', () => {
  const spread = (markup: string) => page(`...sanitizeInputs({}).inputs,
  $listKeys: { incomes: "id" },
  $watch: { filingType() {} },
  routeName: "",
  get incomeTotal() { return this.$getAll("incomes.*.amount", []).length; },`, markup);

  it('spread の横に getter などがあっても、spread が持ち込むキーを存在しないと言わない（束縛・$watch のキー・getter の中の読み）', () => {
    const html = spread(`<p>{{ filingType }}{{ incomeTotal }}</p><template data-wcs="for: incomes"><i>{{ .amount }}</i></template>`);
    const all = validateDocument(html, { locale: 'en' });
    expect(all.filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('stateSchema が無ければ、spread の上に info を 1 回だけ出し、検査を入れる手段（stateSchema・wcs-schema）を示す', () => {
    const html = spread('<p>{{ filingType }}</p>');
    const found = find(html, WcsDiagnosticCode.PathDynamicUnknown);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['...sanitizeInputs({}).inputs']);
    expect(found[0].severity).toBe('info');
    expect(found[0].message).toContain('stateSchema of wcstack.manifest.json');
    expect(found[0].message).toContain('npx wcs-schema');
    // the last entry, with no comma after it
    const last = page('routeName: "",\n  ...rest ');
    expect(texts(last, WcsDiagnosticCode.PathDynamicUnknown)).toEqual(['...rest']);
  });

  it('stateSchema があれば info は出さず、schema に無い束縛のパスは従来どおり wcs/path-nonexistent', () => {
    const html = spread('<p>{{ filingTyp }}</p>');
    expect(find(html, WcsDiagnosticCode.PathDynamicUnknown, SCHEMA)).toEqual([]);
    expect(texts(html, WcsDiagnosticCode.PathNonexistent, SCHEMA)).toEqual(['filingTyp']);
  });

  it('spread の無い state は従来どおり読み、存在しないパスを報告する', () => {
    const html = page('routeName: "",', '<p>{{ routeNmae }}</p>');
    expect(texts(html, WcsDiagnosticCode.BindingPathMissing)).toEqual(['routeNmae']);
    expect(find(html, WcsDiagnosticCode.PathDynamicUnknown)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import type { CodeMapping } from '@volar/language-core';
import { getterAnnotationOffsets, GETTER_RETURN_ANNOTATION } from '../src/language/getterAnnotations';
import { buildCombinedScript, createWcsLanguagePlugin } from '../src/language/plugin';
import { parseWcsScriptBlocks } from '../src/language/htmlParse';

/** `code` の各オフセットに注釈を挟んだ文字列（オフセットの確認用）。 */
function annotate(code: string): string {
  let out = '';
  let at = 0;
  for (const offset of getterAnnotationOffsets(code)) {
    out += code.slice(at, offset) + GETTER_RETURN_ANNOTATION;
    at = offset;
  }
  return out + code.slice(at);
}

describe('getterAnnotationOffsets — this を読む state の getter に `: any` を挟む位置', () => {
  it('export default {} 直下の、this を読む getter の `)` の直後だけ', () => {
    const code = `export default {
  count: 0,
  get double() { return this.count * 2; },
  get "items.*.total"() { return this["items.*.price"] * 2; },
  get now() { return Date.now(); },
  inc() { this.count++; },
  get viaArrow() { return () => this.count; },
  get viaFunction() { return function () { return this.count; }; },
};`;
    expect(annotate(code)).toBe(`export default {
  count: 0,
  get double(): any { return this.count * 2; },
  get "items.*.total"(): any { return this["items.*.price"] * 2; },
  get now() { return Date.now(); },
  inc() { this.count++; },
  get viaArrow(): any { return () => this.count; },
  get viaFunction() { return function () { return this.count; }; },
};`);
  });

  it('export default defineState({}) の形でも同じ。入れ子のオブジェクトの getter には付けない', () => {
    const code = `export default defineState({ a: 1, get b() { return this.a; }, nested: { get c() { return this.a; } } });`;
    expect(annotate(code)).toBe(`export default defineState({ a: 1, get b(): any { return this.a; }, nested: { get c() { return this.a; } } });`);
  });

  it('付けない: パースできない（構文エラー・TypeScript の構文）、export default が無い、`)` と `{` の間にコメント', () => {
    expect(getterAnnotationOffsets(`export default { get a() { return this.b; }`)).toEqual([]);
    expect(getterAnnotationOffsets(`export default { items: [] as string[], get a() { return this.items; } };`)).toEqual([]);
    expect(getterAnnotationOffsets(`const s = { get a() { return this.b; } };`)).toEqual([]);
    expect(getterAnnotationOffsets(`export default makeState({ get a() { return this.b; } });`)).toEqual([]);
    expect(getterAnnotationOffsets(`export default { get a() /* c */ { return this.b; } };`)).toEqual([]);
  });
});

/** 仮想コードを strict の本物の TypeScript に通し、診断を「HTML に戻した位置の文字列」と code で返す。 */
function check(html: string, virtual: { code: string; mappings: CodeMapping[] }, strict: boolean): { code: number; at: string }[] {
  const fileName = 'virtual.ts';
  const options: ts.CompilerOptions = {
    strict,
    noImplicitThis: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
    noEmit: true,
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, ...rest) =>
    name === fileName ? ts.createSourceFile(fileName, virtual.code, version, true) : original(name, version, ...rest);
  const program = ts.createProgram([fileName], options, host);
  const back = (generated: number): number | undefined => {
    for (const m of virtual.mappings) {
      const g = m.generatedOffsets[0];
      if (generated >= g && generated < g + m.lengths[0]) return m.sourceOffsets[0] + (generated - g);
    }
    return undefined;
  };
  return ts.getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === fileName)
    .map((d) => {
      const start = back(d.start!);
      return { code: d.code, at: start === undefined ? '(unmapped)' : html.slice(start, start + d.length!) };
    });
}

const PAGE = `<!doctype html>
<wcs-state>
  <script type="module">
    import { defineState } from "https://esm.run/@wcstack/state";
    export default {
      items: [{ name: "a", price: 1 }],
      count: 0,
      get first() { return this.items[0].nmae; },
      get total() { return this.coutn + 1; },
      method() { return this.items[0].nmae; },
      get okName() { return this.items[0].name; },
      get okPath() { return this["items.*.price"] * 2; },
      get okApi() { return this.$getAll("items.*.price", []).length + this.$1; },
      get okItems() { return this.items.filter((i) => i.price > 0); },
      get okList() { return this.items.map((i) => ({ label: i.name })); },
      okCallsGetter() { return this.first; },
    };
  </script>
</wcs-state>`;
const EXPECTED = [
  { code: 2339, at: 'nmae' },
  { code: 2551, at: 'coutn' },
  { code: 2339, at: 'nmae' },
];

describe('getter の本体を確定した this で検査する（TypeScript の推論の循環を注釈で切る）', () => {
  it('Language Server モード: getter の typo を HTML の位置で報告し、getter のコールバックは型が付く（strict / loose）', () => {
    const plugin = createWcsLanguagePlugin();
    const snapshot = { getText: (s: number, e: number) => PAGE.slice(s, e), getLength: () => PAGE.length, getChangeRange: () => undefined };
    const root = plugin.createVirtualCode!('/proj/index.html', 'html', snapshot, {} as any)!;
    const embedded = root.embeddedCodes![0];
    const virtual = { code: embedded.snapshot.getText(0, embedded.snapshot.getLength()), mappings: embedded.mappings };
    expect(virtual.code).toContain('get first(): any { return this.items[0].nmae; }');
    for (const strict of [true, false]) {
      expect(check(PAGE, virtual, strict), `strict=${strict}`).toEqual(EXPECTED);
    }
  });

  it('tsc モード（合成スクリプト）でも同じ', () => {
    const virtual = buildCombinedScript(parseWcsScriptBlocks(PAGE, 'wcs-state'));
    expect(virtual.code).toContain('get total(): any { return this.coutn + 1; }');
    for (const strict of [true, false]) {
      expect(check(PAGE, virtual, strict), `strict=${strict}`).toEqual(EXPECTED);
    }
  });
});

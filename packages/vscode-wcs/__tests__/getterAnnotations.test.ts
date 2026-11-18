import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import type { CodeMapping } from '@volar/language-core';
import { getterAnnotationOffsets, GETTER_RETURN_ANNOTATION } from '../src/language/getterAnnotations';
import { buildCombinedScript, createWcsLanguagePlugin } from '../src/language/plugin';
import { parseWcsScriptBlocks } from '../src/language/htmlParse';

// `code` の各オフセットに目印のコメント A を挟んだ文字列（オフセットの確認用。挿入する注釈そのものは下で確かめる）。
function annotate(code: string): string {
  let out = '';
  let at = 0;
  for (const offset of getterAnnotationOffsets(code)) {
    out += code.slice(at, offset) + '/*A*/';
    at = offset;
  }
  return out + code.slice(at);
}

describe('getterAnnotationOffsets — this を読む state の getter の前に戻り値の型 any の JSDoc を挟む位置', () => {
  it('挿入する注釈は改行で始まる JSDoc（前のトークンと同じ行に続くコメントは TypeScript が JSDoc にしない）', () => {
    expect(GETTER_RETURN_ANNOTATION).toBe('\n/** @returns {any} */ ');
  });

  it('export default {} 直下の、this を読む getter の先頭（get の位置）だけ', () => {
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
  /*A*/get double() { return this.count * 2; },
  /*A*/get "items.*.total"() { return this["items.*.price"] * 2; },
  get now() { return Date.now(); },
  inc() { this.count++; },
  /*A*/get viaArrow() { return () => this.count; },
  get viaFunction() { return function () { return this.count; }; },
};`);
  });

  it('export default defineState({}) の形でも同じ。入れ子のオブジェクトの getter には付けない', () => {
    const code = `export default defineState({ a: 1, get b() { return this.a; }, nested: { get c() { return this.a; } } });`;
    expect(annotate(code)).toBe(`export default defineState({ a: 1, /*A*/get b() { return this.a; }, nested: { get c() { return this.a; } } });`);
  });

  it('付けない: パースできない（構文エラー・TypeScript の構文）、export default が無い、defineState 以外の呼び出し', () => {
    expect(getterAnnotationOffsets(`export default { get a() { return this.b; }`)).toEqual([]);
    expect(getterAnnotationOffsets(`export default { items: [] as string[], get a() { return this.items; } };`)).toEqual([]);
    expect(getterAnnotationOffsets(`const s = { get a() { return this.b; } };`)).toEqual([]);
    expect(getterAnnotationOffsets(`export default makeState({ get a() { return this.b; } });`)).toEqual([]);
  });

  it('作者が JSDoc で戻り値の型を書いた getter（@returns / @return / @type）には付けない。型を書かない JSDoc やコメントの後ろには付ける', () => {
    const code = `export default {
  a: 1,
  /** @returns {number} */ get typed() { return this.a; },
  /**
   * 説明
   * @return {number}
   */
  get typed2() { return this.a; },
  /** @type {number} */
  get typed3() { return this.a; },
  /** 説明だけ */
  get untyped() { return this.a; },
  // 行コメント
  get afterLine() { return this.a; },
  /** @returns {number} */ /* c */ get typed4() { return this.a; },
  /** @returns {number} */ b: 1, get afterOther() { return this.a; },
};`;
    expect(annotate(code)).toBe(`export default {
  a: 1,
  /** @returns {number} */ get typed() { return this.a; },
  /**
   * 説明
   * @return {number}
   */
  get typed2() { return this.a; },
  /** @type {number} */
  get typed3() { return this.a; },
  /** 説明だけ */
  /*A*/get untyped() { return this.a; },
  // 行コメント
  /*A*/get afterLine() { return this.a; },
  /** @returns {number} */ /* c */ get typed4() { return this.a; },
  /** @returns {number} */ b: 1, /*A*/get afterOther() { return this.a; },
};`);
  });
});

/**
 * 仮想コードを本物の TypeScript に通し、診断を「HTML に戻した位置の文字列」と code で返す。仮想コードは
 * JavaScript（4.26）なので virtual.js。checkJs も noImplicitThis も付けない — preamble の `// @ts-check` が
 * 検査を有効にし、JavaScript では ThisType<> の `this` が noImplicitThis 無しで効く。
 */
function check(html: string, virtual: { code: string; mappings: CodeMapping[] }, strict: boolean): { code: number; at: string }[] {
  const fileName = 'virtual.js';
  const options: ts.CompilerOptions = {
    strict,
    allowJs: true,
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
// strict でない（noImplicitAny が無い）とき、JavaScript のオブジェクトリテラルの型は開いている（知らない
// プロパティの読みは any — checkJs の規則）: 配列の要素のリテラル（`items[0].nmae`）の typo は報告されない。
// state そのもの（`this.coutn`）は報告される。
const EXPECTED_LOOSE = [
  { code: 2551, at: 'coutn' },
];

describe('getter の本体を確定した this で検査する（TypeScript の推論の循環を注釈で切る）', () => {
  it('Language Server モード: getter の typo を HTML の位置で報告し、getter のコールバックは型が付く（strict。loose はオブジェクトリテラルが開く）', () => {
    const plugin = createWcsLanguagePlugin();
    const snapshot = { getText: (s: number, e: number) => PAGE.slice(s, e), getLength: () => PAGE.length, getChangeRange: () => undefined };
    const root = plugin.createVirtualCode!('/proj/index.html', 'html', snapshot, {} as any)!;
    const embedded = root.embeddedCodes![0];
    const virtual = { code: embedded.snapshot.getText(0, embedded.snapshot.getLength()), mappings: embedded.mappings };
    expect(virtual.code).toContain('/** @returns {any} */ get first() { return this.items[0].nmae; }');
    expect(check(PAGE, virtual, true)).toEqual(EXPECTED);
    expect(check(PAGE, virtual, false)).toEqual(EXPECTED_LOOSE);
  });

  it('tsc モード（合成スクリプト）でも同じ', () => {
    const virtual = buildCombinedScript(parseWcsScriptBlocks(PAGE, 'wcs-state'));
    expect(virtual.code).toContain('/** @returns {any} */ get total() { return this.coutn + 1; }');
    expect(check(PAGE, virtual, true)).toEqual(EXPECTED);
    expect(check(PAGE, virtual, false)).toEqual(EXPECTED_LOOSE);
  });

  it('1 行に書いた state の getter にも効く（注釈は改行で始まるので、前の , と同じ行のコメントにならない）', () => {
    const page = `<wcs-state><script type="module">export default { items: [{ name: "a" }], get first() { return this.items[0].nmae; }, get ok() { return this.items.map((i) => i.name); } };</script></wcs-state>`;
    const virtual = buildCombinedScript(parseWcsScriptBlocks(page, 'wcs-state'));
    expect(check(page, virtual, true)).toEqual([{ code: 2339, at: 'nmae' }]);
  });
});

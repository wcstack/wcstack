import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { WCS_PREAMBLE } from '../src/language/preamble';

/**
 * preamble の 4.0 の差（@wcstack/state 4.0 の defineState と対）を、本物の TypeScript コンパイラに通して
 * 確かめる（preamble.test.ts と同じく strict・noImplicitAny）。
 *   - 4.0 で外れた API の旧名（`$trackDependency` / `$untrackDependency`）は型に無い
 *   - 4.0 で外れた宣言（`$scan` / `$streams`）は型付けしない。`$stream` の値は this から読める
 *   - 4.0 の設定の宣言 `$behavior`（boolean の 3 キー）と `$features`（後付けの名前）を型付けする
 */
function typecheck(userCode: string): string[] {
  const fileName = 'virtual.ts';
  const source = WCS_PREAMBLE + userCode;
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
    noEmit: true,
  };
  const host = ts.createCompilerHost(options);
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, ...rest) =>
    name === fileName
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : origGetSourceFile(name, languageVersion, ...rest);
  const program = ts.createProgram([fileName], options, host);
  return ts.getPreEmitDiagnostics(program)
    .filter(d => d.file?.fileName === fileName)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

describe('WCS_PREAMBLE — @wcstack/state 4.0', () => {
  it('4.0 で外れた宣言（$scan / $streams）と API の旧名は preamble に型として現れない', () => {
    expect(WCS_PREAMBLE).not.toContain('$scan');
    expect(WCS_PREAMBLE).not.toContain('$streams');
    expect(WCS_PREAMBLE).not.toContain('$trackDependency');
    expect(WCS_PREAMBLE).not.toContain('$untrackDependency');
  });

  it('API の旧名（$trackDependency）を呼ぶと型エラーになり、正式名（$dependOn / $untracked）は通る', () => {
    const errors = typecheck(`
defineState({
  a: 1,
  get x(): number { this.$dependOn("a"); return this.$untracked(() => this.a); },
  get y(): number { this.$trackDependency("a"); return 0; },
});
`);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("'$trackDependency'");
  });

  it('getter / メソッドの this から $stream の値を読める（型は any）、事前宣言があればその型を保つ', () => {
    expect(typecheck(`
defineState({
  page: 1,
  $stream: { pageResult: { args: (s: any) => s.page, source: async function* () {} } },
  get kind(): unknown { return this.pageResult; },
});
`)).toEqual([]);
    const errors = typecheck(`
defineState({
  pageResult: 0 as number,
  $stream: { pageResult: { source: async function* () {} } },
  m() { const k: string = this.pageResult; return k; },
});
`);
    expect(errors.some(message => message.includes("'number' is not assignable to type 'string'"))).toBe(true);
  });

  it('$behavior の 3 キーは boolean、$features は後付けの名前の配列として型付けされる', () => {
    expect(typecheck(`
defineState({
  count: 0,
  $behavior: { enableMustache: false, sameValueGuard: true, enableDirectionalInitialSync: false },
  $features: ["temporal", "formats", "list-keys"],
});
`)).toEqual([]);
    // T（引数から推論した型）との交差になるので、型の違う値は never への代入として報告される。
    // 知らないキー（`enableMustach`）は T が持つので型エラーにならない — lint（wcs/behavior-invalid）が報告する
    expect(typecheck(`
defineState({ count: 0, $behavior: { enableMustache: "no" } });
`)).toEqual(["Type 'string' is not assignable to type 'never'."]);
    expect(typecheck(`
defineState({ count: 0, $features: ["temporl"] });
`)).toEqual(["Type 'string' is not assignable to type 'never'."]);
  });
});

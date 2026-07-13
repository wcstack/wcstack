import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { WCS_PREAMBLE } from '../src/language/preamble';

/**
 * preamble は仮想 TypeScript ドキュメントの先頭に注入される文字列なので、
 * ビルドでは型検査されない。ここで実際に TypeScript コンパイラに通して
 * 「preamble 自体が валид」「想定ユースケースが型エラーにならない」ことを保証する。
 */
function typecheck(userCode: string): readonly ts.Diagnostic[] {
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
  return ts.getPreEmitDiagnostics(program).filter(d => d.file?.fileName === fileName);
}

function messages(diags: readonly ts.Diagnostic[]): string[] {
  return diags.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

describe('WCS_PREAMBLE の型検査', () => {
  it('preamble 単体が型エラーなくコンパイルできる', () => {
    const diags = typecheck('');
    expect(messages(diags)).toEqual([]);
  });

  it('基本的な defineState の利用が型エラーにならない', () => {
    const diags = typecheck(`
defineState({
  count: 0,
  users: [] as { name: string; age: number }[],
  increment() {
    this.count++;
    const name: string = this["users.*.name"];
    void name;
  },
});
`);
    expect(messages(diags)).toEqual([]);
  });

  it('$getAll は (path, indexes?) シグネチャ（ランタイム getAll.ts と一致）', () => {
    const diags = typecheck(`
defineState({
  items: [] as { price: number }[],
  sum: 0,
  recalc() {
    this.sum = this.$getAll("items.*.price").length + this.$getAll("items.*.price", [0]).length;
  },
});
`);
    expect(messages(diags)).toEqual([]);
  });

  it('$command / $streamStatus / $streamError 名前空間にアクセスできる', () => {
    const diags = typecheck(`
defineState({
  filter: "all",
  $commandTokens: ["play"],
  $streams: {
    metrics: {
      source: (_args: unknown, _signal: AbortSignal) => (async function* () { yield 1; })(),
      initial: [] as number[],
    },
  },
  handle() {
    this.$command.play.emit();
    const st: "idle" | "active" | "done" | "error" = this["$streamStatus.metrics"];
    const err: unknown = this["$streamError.metrics"];
    const st2 = this.$streamStatus.metrics;
    void st; void err; void st2;
  },
});
`);
    expect(messages(diags)).toEqual([]);
  });

  it('$ 予約キーはドットパスアクセサに含まれない（$streams.metrics は型エラー）', () => {
    const diags = typecheck(`
defineState({
  $streams: {
    metrics: { source: () => (async function* () { yield 1; })(), initial: 0 },
  },
  handle() {
    this["$streams.metrics"];
  },
});
`);
    expect(diags.length).toBeGreaterThan(0);
  });
});

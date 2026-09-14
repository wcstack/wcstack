import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { WCS_PREAMBLE } from '../src/language/preamble';

/**
 * `$scan` 宣言の型（preamble の `_WcsScan`）が、想定する書き方で型エラーにならないことを確かめる。
 * preamble.test.ts と同じく本物の TypeScript コンパイラに通す（strict・noImplicitAny）。
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

describe('WCS_PREAMBLE — $scan', () => {
  it('from / on / resetOn の宣言と fold の引数が暗黙 any にならずに型付けされる', () => {
    expect(typecheck(`
defineState({
  page: 1,
  host: "a",
  $eventTokens: ["message"],
  $scan: {
    total: { from: "page", initial: 0, fold: (acc, cur, prev) => acc + cur - (prev ?? 0) },
    log: {
      on: "message",
      initial: [] as string[],
      fold(acc, event, index) { return [...acc, String(event) + index]; },
      resetOn: ["host"],
    },
  },
});
`)).toEqual([]);
  });

  it('fold は this 無しで呼ばれるので、メソッド形の fold で this を読むと型エラーになる', () => {
    const errors = typecheck(`
defineState({
  page: 1,
  $scan: { total: { from: "page", initial: 0, fold(acc, cur) { return acc + cur + this.page; } } },
});
`);
    expect(errors.some(message => message.includes('void'))).toBe(true);
  });

  it('getter / メソッドの this から $scan の出力と $streams の値を読める（型は any）', () => {
    expect(typecheck(`
defineState({
  page: 1,
  $streams: { pageResult: { args: (s: any) => s.page, source: async function* () {} } },
  $scan: { feed: { from: "pageResult", initial: { items: [] as number[] }, fold: (acc: any) => acc } },
  get loaded(): number { return this.feed.items.length; },
  get kind(): unknown { return this.pageResult; },
  ids() { return this.feed.items.map((item: any) => item.id); },
});
`)).toEqual([]);
  });

  it('同名のプロパティを明示的に事前宣言していれば、その型を保つ（any に潰さない）', () => {
    const scanErrors = typecheck(`
defineState({
  feed: "x" as string,
  n: 0,
  $scan: { feed: { from: "n", initial: "", fold: (acc: any) => acc } },
  m() { const k: number = this.feed; return k; },
});
`);
    expect(scanErrors.some(message => message.includes("'string' is not assignable to type 'number'"))).toBe(true);
    const streamErrors = typecheck(`
defineState({
  pageResult: 0 as number,
  $streams: { pageResult: { source: async function* () {} } },
  m() { const k: string = this.pageResult; return k; },
});
`);
    expect(streamErrors.some(message => message.includes("'number' is not assignable to type 'string'"))).toBe(true);
  });

  it('initial と fold は必須として型に現れる', () => {
    const missing = typecheck(`
defineState({
  page: 1,
  $scan: { total: { from: "page", fold: (acc: number) => acc } },
});
`);
    expect(missing.some(message => message.includes('initial'))).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import ts from 'typescript';
import { defineState } from '../src/defineState';

describe('defineState', () => {
  it('引数をそのまま返す（アイデンティティ関数）', () => {
    const definition = {
      count: 0,
      name: "test",
      increment() { /* noop */ },
    };
    const result = defineState(definition);
    expect(result).toBe(definition);
  });
});

/**
 * `defineState` の型面は tsconfig の `exclude` により build でも検査されないので、
 * ここで実際に TypeScript コンパイラへ通す。VS Code 拡張の preamble
 * （vscode-wcs `__tests__/preamble.test.ts`）と同じ方針で、公開型面とエディタの型面が
 * 割れないことを守る。
 */
const VIRTUAL = path.resolve(__dirname, '__virtualDefineState.ts');

function typecheck(userCode: string): string[] {
  const source = `import { defineState } from '../src/defineState';\n${userCode}`;
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
    noEmit: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, ...rest) =>
    path.resolve(name) === VIRTUAL
      ? ts.createSourceFile(name, source, languageVersion, true)
      : origGetSourceFile(name, languageVersion, ...rest);
  const origFileExists = host.fileExists.bind(host);
  host.fileExists = (name) => path.resolve(name) === VIRTUAL || origFileExists(name);
  const program = ts.createProgram([VIRTUAL], options, host);
  return ts.getPreEmitDiagnostics(program)
    .filter(d => d.file !== undefined && path.resolve(d.file.fileName) === VIRTUAL)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

describe('defineState の型面（tsc で実際に検査する）', () => {
  it('`**` を含むパスの読みが型エラーにならないこと', () => {
    expect(typecheck(`
      defineState({
        nodes: [] as { value: number; children: any[] }[],
        $recursion: { "nodes.*": "children.*" },
        get "nodes.**.total"(): number {
          return (this["nodes.**.value"] as number)
            + (this.$getAll("nodes.**.children.*.total") as number[]).reduce((a, b) => a + b, 0);
        },
        readTotal() { return this["nodes.**.total"] as number; },
      });
    `)).toEqual([]);
  });

  it('素の `nodes.**`（再帰 getter の中でノード自身に束縛される読み）も型エラーにならないこと', () => {
    // Fixed by 第 5 サイクル再検証 — was: 索引が `${string}.**.${string}` だけで、ランタイムでは
    // 読める `this["nodes.**"]` が TS2551 になっていた（VS Code 拡張の preamble も同じ）。
    expect(typecheck(`
      defineState({
        nodes: [] as { value: number; children: any[] }[],
        $recursion: { "nodes.*": "children.*" },
        get "nodes.**.selfValue"(): number {
          return (this["nodes.**"] as { value: number }).value;
        },
      });
    `)).toEqual([]);
  });

  it('`**` の索引シグネチャが通常のドットパスの型付けを損なわないこと', () => {
    const diags = typecheck(`
      defineState({
        nodes: [] as { value: number }[],
        bad() { return this["nodes.*.nope"]; },
      });
    `);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.join('\n')).toContain('nodes.*.nope');
  });

  it('宣言済みの通常パスは値の型が保たれること', () => {
    expect(typecheck(`
      defineState({
        nodes: [] as { value: number }[],
        ok() { const n: number = this["nodes.*.value"]; return n; },
      });
    `)).toEqual([]);
  });
}, 30000);

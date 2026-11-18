import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { proxyCreateProgram } from '@volar/typescript/lib/node/proxyCreateProgram.js';
import { createWcsLanguagePlugin } from '../src/language/plugin';

/**
 * wcs-tsc の経路（@volar/typescript の proxyCreateProgram ＋ tsc モードのプラグイン）を本物の TypeScript で通し、
 * 診断が HTML の位置に戻ることを確かめる。インラインスクリプトは JavaScript として検査する（4.26、
 * lending-desk F-13）: JSDoc の型が効き、TypeScript の構文は TS8010 系のエラーになる。
 * runTsc は tsc.js に `.html` を対応拡張子として足すが、ここでは同じことを allowNonTsExtensions で代える。
 */
const BASE = mkdtempSync(join(tmpdir(), 'wcs-tsc-js-'));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));
let cases = 0;

function check(files: Record<string, string>, extra: ts.CompilerOptions = {}): string[] {
  const root = join(BASE, String(cases++)).split('\\').join('/');
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text, 'utf8');
  }
  const options = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], noEmit: true, skipLibCheck: true, types: [],
    allowNonTsExtensions: true, ...extra,
  } as ts.CompilerOptions;
  const host = ts.createCompilerHost(options);
  const createProgram = proxyCreateProgram(ts, ts.createProgram, () => [createWcsLanguagePlugin('wcs-state', { mode: 'tsc' })]);
  const rootNames = Object.keys(files).filter((file) => file.endsWith('.html')).map((file) => `${root}/${file}`);
  const program = createProgram({ rootNames, options, host });
  const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
  return diagnostics.map((d) => {
    const { line, character } = d.file!.getLineAndCharacterOfPosition(d.start!);
    const text = d.file!.text.slice(d.start!, d.start! + d.length!);
    return `${d.file!.fileName.slice(root.length + 1)}(${line + 1},${character + 1}) TS${d.code} ${text}`;
  });
}

describe('wcs-tsc の経路: インラインスクリプトは JavaScript として検査する（4.26）', () => {
  it('JSDoc の型が効く（@typedef import()・@type・@param）— 4.25 までの偽の TS2339 / TS7006 が消える', () => {
    expect(check({
      'api.ts': 'export interface Reservation { id: number; status: "pending" | "ready" }\n',
      'counter.html': `<!doctype html>
<wcs-state>
  <script type="module">
    /** @typedef {import("./api").Reservation} Reservation */
    /** @param {number} n */
    function twice(n) { return n * 2; }
    export default {
      /** @type {Reservation[]} */
      pickups: [],
      total: 0,
      get first() { return this.pickups[0]?.status ?? "none"; },
      get doubled() { return twice(this.total); },
      pick() { return this.pickups[0]?.stauts; },
    };
  </script>
</wcs-state>`,
    }, { strict: true })).toEqual([
      'counter.html(13,40) TS2551 stauts',
    ]);
  });

  it('TypeScript の構文（型注釈・import type・as）は HTML の位置で TS8010 系のエラー', () => {
    expect(check({
      'x.ts': 'export type X = number;\n',
      'ts-syntax.html': `<wcs-state>
  <script type="module">
    import type { X } from "./x";
    const typed: number = 1;
    export default {
      total: typed,
      set(v: string) { this.total = v.length; },
      items: [] as string[],
    };
  </script>
</wcs-state>`,
    }, { strict: true })).toEqual([
      'ts-syntax.html(3,5) TS8006 import type { X } from "./x";',
      'ts-syntax.html(4,18) TS8010 number',
      'ts-syntax.html(7,14) TS8010 string',
      'ts-syntax.html(8,20) TS8016 string[]',
    ]);
  });

  it('checkJs も noImplicitThis も無い tsconfig でも検査する（プリアンブルの // @ts-check と JavaScript の this）', () => {
    expect(check({
      'index.html': `<wcs-state><script type="module">
export default { count: 0, inc() { this.coutn++; } };
</script></wcs-state>`,
    })).toEqual([
      'index.html(2,41) TS2551 coutn',
    ]);
  });

  it('$on のハンドラの state と $command に型が付く（lending-desk F-05 / F-06）', () => {
    expect(check({
      'on.html': `<wcs-state><script type="module">
export default {
  count: 0,
  $commandTokens: ["reload"],
  $eventTokens: ["picked"],
  $on: {
    picked(state, event) { state.count++; state.$command.reload.emit(event.type); state.cuont; },
  },
  go() { this.$command.relaod.emit(); },
};
</script></wcs-state>`,
    }, { strict: true, noUncheckedIndexedAccess: true })).toEqual([
      'on.html(7,89) TS2551 cuont',
      'on.html(9,24) TS2551 relaod',
    ]);
  });
});

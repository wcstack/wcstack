/**
 * define-state-types.test.ts — defineState の型（src/public/defineState.ts）を本物の TypeScript に通して確かめる。
 * defineState はランタイムでは恒等関数なので、確かめるのは型だけ: 断片を strict（＋ noUncheckedIndexedAccess）で
 * 検査し、診断を「行: TSコード 文面」で比べる。
 *   - 4.26: `$on` のハンドラ `(state, event, ...indexes)` に文脈の型が付く（lending-desk F-05）
 *   - 4.26: `$command` を `$commandTokens` の名前に絞る（lending-desk F-06）
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import ts from "typescript";

const DEFINE = resolve(__dirname, "../src/public/defineState.ts").replace(/\\/g, "/");
const FILE = resolve(__dirname, "__define_state_probe__.ts").replace(/\\/g, "/");

/** A TypeScript program per case is slow (the more so under coverage). */
const TS_TIMEOUT = 60_000;

function check(code: string, extra: ts.CompilerOptions = {}): string[] {
  const source = `import { defineState, type WcsThis, type WcsStateApi } from ${JSON.stringify(DEFINE.replace(/\.ts$/, ""))};\n${code}`;
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], types: [], ...extra,
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, ...rest) =>
    name.replace(/\\/g, "/") === FILE ? ts.createSourceFile(name, source, version, true) : original(name, version, ...rest);
  const original2 = host.fileExists.bind(host);
  host.fileExists = (name) => name.replace(/\\/g, "/") === FILE || original2(name);
  const program = ts.createProgram([FILE], options, host);
  return ts.getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName.replace(/\\/g, "/") === FILE)
    .map((d) => {
      const line = d.file!.getLineAndCharacterOfPosition(d.start!).line;   // line 0 is the import
      return `${line}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, 90)}`;
    });
}

describe("defineState — $on のハンドラの型（4.26）", { timeout: TS_TIMEOUT }, () => {
  it("state は state（データの型・API・パス）、event は CustomEvent（detail は any — wc-bindable の既定の getter）、続く引数は number", () => {
    expect(check(`
export default defineState({
  total: 0,
  label: "x",
  maybe: null as string | null,
  items: [] as { price: number }[],
  $eventTokens: ["picked"],
  add(n: number) { this.total += n; },
  $on: {
    picked(state, event, index) {
      const t: number = state.total;
      const l: string = state.label.toUpperCase();
      const e: Event = event;
      const d: { anything: 1 } = event.detail;
      const i: number = index;
      state.add(1);
      state.$getAll("items.*.price");
      void t, l, e, d, i;
    },
    arrow: (state) => state.items.length,
  },
});
`)).toEqual([]);
  });

  it("state の typo・型の違う代入・this は型エラー（メソッドは any で、引数は検査しない）", () => {
    expect(check(`
export default defineState({
  total: 0,
  maybe: null as string | null,
  add(n: number) { this.total += n; },
  $on: {
    a(state) { state.totl; },
    b(state) { state.maybe = 1; },
    c() { this.total; },
    d(state) { state.add("not checked"); },
  },
});
`)).toEqual([
      "7: TS2551 Property 'totl' does not exist on type 'WcsOnState<{ total: number; maybe: string | null; ",
      "8: TS2322 Type 'number' is not assignable to type 'string'.",
      "9: TS2339 Property 'total' does not exist on type 'void'.",
    ]);
  });

  it("$on があってもメソッド・getter の this と戻り値の型は損なわれない", () => {
    expect(check(`
const s = defineState({
  count: 0,
  inc(by: number) { this.coutn += by; },
  get double(): number { return this.count * 2; },
  $on: { picked(state) { state.count++; } },
});
const n: number = s.count;
s.inc(1);
s.zz;
void n;
`)).toEqual([
      "4: TS2551 Property 'coutn' does not exist on type 'WcsThis<{ count: number; inc(by: number): void; r",
      "10: TS2339 Property 'zz' does not exist on type '{ count: number; inc(by: number): void; readonly dou",
    ]);
  });

  it("event への注釈（CustomEvent<…>・Event）も通る", () => {
    expect(check(`
export default defineState({
  n: 0,
  $on: {
    picked(state, event: CustomEvent<{ id: number }>) { state.n = event.detail.id; },
    arrow: (state, event: CustomEvent<number>) => { state.n = event.detail; },
    plain(state, event: Event) { state.n = event.timeStamp; },
  },
});
`)).toEqual([]);
  });
});

describe("defineState — $command を $commandTokens に絞る（4.26）", { timeout: TS_TIMEOUT }, () => {
  it("宣言した名前だけが型に現れ、typo は型エラー。noUncheckedIndexedAccess でも undefined を含まない", () => {
    expect(check(`
export default defineState({
  $commandTokens: ["reload", "stop"],
  go() {
    this.$command.reload.emit();
    this.$command.stop.emit(1, 2);
    this.$command.relaod.emit();
  },
  $on: { picked(state) { state.$command.reload.emit(); state.$command.nope.emit(); } },
});
`, { noUncheckedIndexedAccess: true })).toEqual([
      `7: TS2551 Property 'relaod' does not exist on type 'Record<"reload" | "stop", { emit(...args: any[])`,
      `9: TS2339 Property 'nope' does not exist on type 'Record<"reload" | "stop", { emit(...args: any[]): `,
    ]);
  });

  it("$commandTokens が無い・型引数を <T> だけ渡す: 今までどおり Record<string, …>（noUncheckedIndexedAccess では undefined を含む）", () => {
    expect(check(`
export default defineState({
  go() { this.$command.anything.emit(); },
});
defineState<{ a: number; go(): void }>({ a: 1, go() { this.$command.anything.emit(); } });
`)).toEqual([]);
    expect(check(`
export default defineState({ go() { this.$command.anything.emit(); } });
`, { noUncheckedIndexedAccess: true })).toEqual([
      "2: TS2532 Object is possibly 'undefined'.",
    ]);
  });

  it("const T を使わないので、state の配列は readonly にならない（$commandTokens も）", () => {
    expect(check(`
const s = defineState({ list: [1, 2], $commandTokens: ["a"] });
s.list.push(3);
s.$commandTokens.push("a");
`)).toEqual([]);
  });

  it("WcsThis<T> / WcsStateApi は型引数 1 つでも使える（N は string）", () => {
    expect(check(`
type S = { count: number };
const f = (s: WcsThis<S>) => s.$command.x;
const g = (a: WcsStateApi) => a.$command.y;
void f, g;
`)).toEqual([]);
  });
});

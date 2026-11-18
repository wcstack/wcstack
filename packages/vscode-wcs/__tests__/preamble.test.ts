import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { WCS_PREAMBLE } from '../src/language/preamble';

/**
 * preamble は仮想ドキュメントの先頭に注入される文字列なので、ビルドでは型検査されない。
 * ここで実際に TypeScript コンパイラに通して「preamble 自体が正しい」「想定ユースケースが型エラーにならない」
 * ことを保証する。インラインスクリプトはブラウザが JavaScript として実行するので、仮想コードも JavaScript
 * （4.26）: ファイルは `virtual.js`、ユーザーコードの型は JSDoc で書く。`checkJs` は付けない — preamble の
 * `// @ts-check` が検査を有効にする。
 */
function typecheck(userCode: string, extra: ts.CompilerOptions = {}): readonly ts.Diagnostic[] {
  const fileName = 'virtual.js';
  const source = WCS_PREAMBLE + userCode;
  const options: ts.CompilerOptions = {
    strict: true,
    allowJs: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
    noEmit: true,
    ...extra,
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

/** `TS<code> <ユーザーコードの行>` — 位置はユーザーコードの先頭からの行（1 始まり）。 */
function located(diags: readonly ts.Diagnostic[]): string[] {
  const preambleLines = WCS_PREAMBLE.split('\n').length - 1;
  return diags.map(d => `TS${d.code} ${d.file!.getLineAndCharacterOfPosition(d.start!).line - preambleLines + 1}`);
}

describe('WCS_PREAMBLE の型検査', () => {
  it('preamble 単体が型エラーなくコンパイルできる（checkJs 無しでも検査は有効）', () => {
    const diags = typecheck('');
    expect(messages(diags)).toEqual([]);
    expect(WCS_PREAMBLE.startsWith('// @ts-check\n')).toBe(true);
    expect(typecheck('defineState({ a: 1, m() { this.b; } });')).toHaveLength(1);
  });

  it('基本的な defineState の利用が型エラーにならない', () => {
    const diags = typecheck(`
defineState({
  count: 0,
  /** @type {{ name: string; age: number }[]} */
  users: [],
  increment() {
    this.count++;
    /** @type {string} */
    const name = this["users.*.name"];
    void name;
  },
});
`);
    expect(messages(diags)).toEqual([]);
  });

  it('$getAll は (path, indexes?) シグネチャ（ランタイム getAll.ts と一致）', () => {
    const diags = typecheck(`
defineState({
  /** @type {{ price: number }[]} */
  items: [],
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
  $stream: {
    metrics: {
      source: (/** @type {unknown} */ _args, /** @type {AbortSignal} */ _signal) => (async function* () { yield 1; })(),
      initial: /** @type {number[]} */ ([]),
    },
  },
  handle() {
    this.$command.play.emit();
    /** @type {"idle" | "active" | "done" | "error"} */
    const st = this["$streamStatus.metrics"];
    /** @type {unknown} */
    const err = this["$streamError.metrics"];
    const st2 = this.$streamStatus.metrics;
    void st; void err; void st2;
  },
});
`);
    expect(messages(diags)).toEqual([]);
  });

  it('$listKeys のキー指定（フィールド名・関数）が型エラーにならない', () => {
    const diags = typecheck(`
defineState({
  /** @type {{ id: number; name: string }[]} */
  items: [],
  $listKeys: {
    "items": "id",
    "items.*.children": (row) => row.uid,
  },
  async load() {
    this.items = await (await fetch("/api/items")).json();
  },
});
`);
    expect(messages(diags)).toEqual([]);
  });

  it('$watch のハンドラ引数が暗黙 any にならず、this が state 型になる', () => {
    const diags = typecheck(`
defineState({
  isLoading: false,
  /** @type {{ price: number }[]} */
  items: [],
  startedAt: 0,
  $watch: {
    isLoading(cur, prev) {
      if (cur === true && prev === false) { this.startedAt = 1; }
    },
    "items.*.price"(cur, prev, index) {
      void cur; void prev; void index;
      this.isLoading = false;
    },
  },
});
`);
    expect(messages(diags)).toEqual([]);
  });

  it('$listKeys を宣言しても他のプロパティのパス型推論が壊れない', () => {
    const diags = typecheck(`
defineState({
  /** @type {{ id: number; name: string }[]} */
  items: [],
  $listKeys: { "items": "id" },
  check() {
    /** @type {string} */
    const name = this["items.*.name"];
    void name;
  },
});
`);
    expect(messages(diags)).toEqual([]);
  });

  it('$recursion の再帰パス（`nodes.**.value` と素の `nodes.**`）の読みが型エラーにならない', () => {
    // Fixed by cycle-5 re-verification — was: 索引が `${string}.**.${string}` だけで、
    // 再帰 getter の中でノード自身に束縛される `this["nodes.**"]`（ランタイムでは読める）が
    // TS2551 になっていた（@wcstack/state の defineState と対で直した）。
    const diags = typecheck(`
defineState({
  /** @type {{ value: number; children: any[] }[]} */
  nodes: [],
  $recursion: { "nodes.*": "children.*" },
  /** @returns {number} */
  get "nodes.**.selfValue"() {
    return /** @type {{ value: number }} */ (this["nodes.**"]).value + /** @type {number} */ (this["nodes.**.value"]);
  },
});
`);
    expect(messages(diags)).toEqual([]);
  });

  it('$ 予約キーはドットパスアクセサに含まれない（$stream.metrics は型エラー）', () => {
    const diags = typecheck(`
defineState({
  $stream: {
    metrics: { source: () => (async function* () { yield 1; })(), initial: 0 },
  },
  handle() {
    this["$stream.metrics"];
  },
});
`);
    expect(diags.length).toBeGreaterThan(0);
  });
});

describe('WCS_PREAMBLE — インラインスクリプトは JavaScript として検査する（4.26）', () => {
  it('JSDoc の型が効く: @type の配列・@typedef・@param（lending-desk F-13 の 2 つの検体）', () => {
    expect(messages(typecheck(`
/** @typedef {{ id: number; status: "pending" | "ready" }} Reservation */
/** @param {number} n */
function twice(n) { return n * 2; }
defineState({
  /** @type {Reservation[]} */
  pickups: [],
  /** @type {Reservation | null} */
  current: null,
  total: 0,
  add() { this.total = 1; this.current = this.pickups[0] ?? null; },
  get first() { return this.pickups[0]?.status ?? "none"; },
  get doubled() { return twice(this.total); },
});
`))).toEqual([]);
    // JSDoc の型で typo が報告される（TypeScript として読んでいた 4.25 までは never[] / 暗黙の any だった）
    expect(located(typecheck(`
/** @typedef {{ id: number; status: "pending" | "ready" }} Reservation */
defineState({
  /** @type {Reservation[]} */
  pickups: [],
  pick() { return this.pickups[0]?.stauts; },
});
`))).toEqual(['TS2551 6']);
  });

  it('TypeScript の構文は TS8010 系のエラー（ブラウザでは SyntaxError になる）', () => {
    expect(located(typecheck(`
import type { X } from "./x";
const typed: number = 1;
defineState({
  total: typed,
  set(v: string) { this.total = v.length; },
  items: [] as string[],
});
`)).filter((d) => d.startsWith('TS80'))).toEqual(['TS8006 2', 'TS8010 3', 'TS8010 6', 'TS8016 7']);
  });

  it('仮想ファイルはモジュール（型名がほかのファイルの大域に漏れない。トップレベルの await も書ける）', () => {
    expect(WCS_PREAMBLE).toContain('\nexport {};\n');
    expect(messages(typecheck(`
const data = await Promise.resolve(1);
defineState({ data });
`))).toEqual([]);
  });
});

describe('WCS_PREAMBLE — $on のハンドラと $command（4.26、@wcstack/state の defineState と対）', () => {
  it('$on のハンドラ (state, event, ...indexes) に型が付く。state の typo は報告、this は void', () => {
    expect(located(typecheck(`
defineState({
  total: 0,
  label: "x",
  $eventTokens: ["picked"],
  /** @param {number} n */
  add(n) { this.total += n; },
  $on: {
    picked(state, event, index) {
      state.total = index; state.add(1); void event.type; state.total = event.detail; void state.label.toUpperCase();
      state.totl;
    },
    arrow: (state) => state.label.length,
    usesThis() { this.total; },
    /** @param {any} state @param {CustomEvent<{ id: number }>} event */
    typed(state, event) { state.total = event.detail.id; },
  },
});
`))).toEqual(['TS2551 11', 'TS2339 14']);
  });

  it('$on があっても state の this は損なわれない（ハンドラの引数の型が T の推論を止めない）', () => {
    expect(messages(typecheck(`
defineState({
  count: 0,
  inc() { this.coutn++; },
  $on: { picked(state) { state.count++; } },
});
`))[0]).toContain("Property 'coutn' does not exist");
  });

  it('$command は $commandTokens の名前に絞られる（typo は型エラー、noUncheckedIndexedAccess でも undefined を含まない）', () => {
    const page = `
defineState({
  $commandTokens: ["reload"],
  go() { this.$command.reload.emit(); this.$command.relaod.emit(); },
});
`;
    expect(located(typecheck(page, { noUncheckedIndexedAccess: true }))).toEqual(['TS2551 4']);
    // $commandTokens が無ければ今までどおり Record<string, …>
    expect(messages(typecheck(`defineState({ go() { this.$command.anything.emit(); } });`))).toEqual([]);
  });
});

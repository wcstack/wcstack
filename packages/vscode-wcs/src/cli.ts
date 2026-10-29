/**
 * cli.ts — wcstack 静的契約 CI CLI(Phase 5a §7.1 / §8)。
 *
 * repository の HTML(data-wcs バインディング)と wcstack.manifest.json(sidecar)を、
 * VS Code 拡張と **同じ validator core** で検査する。診断は安定した code と
 * source:line:col range を持ち、IDE と一致する(§8 完了条件)。
 *
 * このファイルは node I/O(fs / argv / stdout / exit)のみを担う薄い shell。
 * 検査ロジックは全て core/cli/runValidation.ts(pure・テスト対象)。
 *
 * 使い方: wcs-validate [--attr=data-wcs] [--state-tag=wcs-state] [--lang=ja|en] [--root=<dir>] [--errors-only] [--strict] <file> ...
 *   *.manifest.json → sidecar manifest として検査
 *   .js / .ts / .jsx / .tsx / .vue / .svelte → 読まない(summary の後に `not read:` として名前を出す)
 *   その他(.html 等)→ data-wcs バインディングとして検査。検査するもの(data-wcs・<wcs-*>・wcstack の
 *     script)が何も無いページは summary の後に `nothing to check:` として名前を出す
 *   --lang=ja|en → 診断メッセージの言語。決定則は「--lang > 環境(LC_ALL / LC_MESSAGES /
 *     LANG / Intl の OS ロケール — ja 系なら ja、それ以外は en) > フォールバック en」。
 *     code / range は言語に依らず不変。
 *   --errors-only(別名 --quiet)→ error severity の行だけ表示(warning は count のみ)
 *   --strict → warning があっても exit 1(severity は不変・閾値だけ下げる)。typo
 *     (`wcs/binding-path-missing` = warning)で CI を落としたいときに使う。
 *   --root=<dir>(`--root <dir>` も)→ サイトのルート。`/` から始まる `<wcs-state src>` と import を
 *     その下で読む(`<base href="/ja/">` の下の `src="/app.js"`)。無ければ従来どおり読まない(`wcs/state-src-unread`)。
 */

import { readFileSync } from "node:fs";
import { createFileReader } from "./fileReader.js";
import { inputKindOf, runValidation, type CliFileInput, type RunValidationOptions } from "./core/cli/runValidation.js";
import type { FileReader } from "./service/statePathResolver.js";

// 外部 state reader は node shell 層の単一正本（IDE の Language Server も同じものを使う）。
// 既存の import 経路（テスト・将来の呼び出し）を壊さないよう再エクスポートする。
export { createFileReader } from "./fileReader.js";

/** argv を options とファイル一覧に分ける。IDE の設定に合わせるため attr / state-tag を受ける。 */
export function parseArgs(argv: readonly string[]): { options: RunValidationOptions; files: string[]; root?: string } {
  const options: { bindAttribute?: string; stateTagName?: string; errorsOnly?: boolean; strict?: boolean; locale?: string } = {};
  const files: string[] = [];
  let root: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--root=")) root = arg.slice("--root=".length);
    else if (arg === "--root" && i + 1 < argv.length) root = argv[++i];
    else if (arg.startsWith("--attr=")) options.bindAttribute = arg.slice("--attr=".length);
    else if (arg.startsWith("--state-tag=")) options.stateTagName = arg.slice("--state-tag=".length);
    else if (arg.startsWith("--lang=")) options.locale = arg.slice("--lang=".length);
    else if (arg === "--errors-only" || arg === "--quiet") options.errorsOnly = true;
    else if (arg === "--strict") options.strict = true;
    else if (!arg.startsWith("-")) files.push(arg);
  }
  return { options, files, ...(root !== undefined && root !== "" ? { root } : {}) };
}

/**
 * CLI の言語決定: --lang 明示 > 環境変数(LC_ALL > LC_MESSAGES > LANG) >
 * Intl の OS ロケール > フォールバック 'en'。
 * 返り値は生 locale 文字列（'ja_JP.UTF-8' 等）— ja/en への解決は
 * core/messages.ts の resolveLocale が担う（ja 系以外はすべて en になる）。
 * env 注入はテスト用。
 */
export function resolveCliLocale(
  explicit: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  if (explicit) return explicit;
  const fromEnv = env.LC_ALL || env.LC_MESSAGES || env.LANG;
  if (fromEnv) return fromEnv;
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale || "en";
  } catch {
    return "en";
  }
}

export function main(argv: readonly string[]): number {
  const { options, files, root } = parseArgs(argv);
  const locale = resolveCliLocale(options.locale);
  if (files.length === 0) {
    process.stderr.write("usage: wcs-validate [--attr=data-wcs] [--state-tag=wcs-state] [--lang=ja|en] [--root=<dir>] [--errors-only] [--strict] <file> [<file> ...]\n");
    return 2;
  }

  const inputs: CliFileInput[] = [];
  for (const path of files) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (e) {
      process.stderr.write(`cannot read ${path}: ${(e as Error).message}\n`);
      return 2;
    }
    const kind = inputKindOf(path);
    inputs.push({
      source: path, text, kind,
      fileReader: kind === "html" ? createFileReader(path, undefined, root) : undefined,
      ...(root !== undefined ? { root } : {}),
    });
  }

  const result = runValidation(inputs, { ...options, locale });
  for (const line of result.lines) {
    process.stdout.write(line + "\n");
  }
  // strict で落ちたときに「何で落ちたか」が summary 行だけで読めるよう印を付ける。
  process.stdout.write(
    `\n${result.errorCount} error(s), ${result.warningCount} warning(s), ${result.infoCount} info${options.strict ? " (strict)" : ""}\n`,
  );
  // the files not read and those with nothing to check, shown with --errors-only too: the counts above say
  // nothing about them (docs/seam-apps.md, fw-inventory)
  for (const note of result.notes) process.stdout.write(note + "\n");
  return result.exitCode;
}

// エントリポイント実行。esbuild は CJS を出力するので require/module が使える。
// `wcs-validate` bin(symlink)経由でも argv[1] 依存でなく確実に起動する。
// テスト(vitest = ESM)からの import では typeof require が "undefined" になるため
// この分岐は踏まない。
declare const require: NodeRequire | undefined;
declare const module: NodeModule | undefined;
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

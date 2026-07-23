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
 * 使い方: wcs-validate [--attr=data-wcs] [--state-tag=wcs-state] [--lang=ja|en] [--errors-only] <file> ...
 *   *.manifest.json → sidecar manifest として検査
 *   その他(.html 等)→ data-wcs バインディングとして検査
 *   --lang=ja|en → 診断メッセージの言語(既定 ja。code / range は言語に依らず不変)
 *   --errors-only(別名 --quiet)→ error severity の行だけ表示(warning は count のみ)
 */

import { readFileSync } from "node:fs";
import { runValidation, type CliFileInput, type RunValidationOptions } from "./core/cli/runValidation.js";

function classify(path: string): CliFileInput["kind"] {
  return path.endsWith(".manifest.json") ? "manifest" : "html";
}

/** argv を options とファイル一覧に分ける。IDE の設定に合わせるため attr / state-tag を受ける。 */
export function parseArgs(argv: readonly string[]): { options: RunValidationOptions; files: string[] } {
  const options: { bindAttribute?: string; stateTagName?: string; errorsOnly?: boolean; locale?: string } = {};
  const files: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--attr=")) options.bindAttribute = arg.slice("--attr=".length);
    else if (arg.startsWith("--state-tag=")) options.stateTagName = arg.slice("--state-tag=".length);
    else if (arg.startsWith("--lang=")) options.locale = arg.slice("--lang=".length);
    else if (arg === "--errors-only" || arg === "--quiet") options.errorsOnly = true;
    else if (!arg.startsWith("-")) files.push(arg);
  }
  return { options, files };
}

export function main(argv: readonly string[]): number {
  const { options, files } = parseArgs(argv);
  if (files.length === 0) {
    process.stderr.write("usage: wcs-validate [--attr=data-wcs] [--state-tag=wcs-state] [--lang=ja|en] <file> [<file> ...]\n");
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
    inputs.push({ source: path, text, kind: classify(path) });
  }

  const result = runValidation(inputs, options);
  for (const line of result.lines) {
    process.stdout.write(line + "\n");
  }
  process.stdout.write(
    `\n${result.errorCount} error(s), ${result.warningCount} warning(s), ${result.infoCount} info\n`,
  );
  return result.exitCode;
}

// エントリポイント実行。esbuild は CJS を出力するので require/module が使える。
// `wcs-validate` bin(symlink)経由でも argv[1] 依存でなく確実に起動する。
// テストは core/cli/runValidation を import するため、この分岐は踏まない。
declare const require: NodeRequire | undefined;
declare const module: NodeModule | undefined;
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

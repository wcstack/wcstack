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
 *   --lang=ja|en → 診断メッセージの言語。決定則は「--lang > 環境(LC_ALL / LC_MESSAGES /
 *     LANG / Intl の OS ロケール — ja 系なら ja、それ以外は en) > フォールバック en」。
 *     code / range は言語に依らず不変。
 *   --errors-only(別名 --quiet)→ error severity の行だけ表示(warning は count のみ)
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runValidation, type CliFileInput, type RunValidationOptions } from "./core/cli/runValidation.js";
import type { FileReader } from "./service/statePathResolver.js";

function classify(path: string): CliFileInput["kind"] {
  return path.endsWith(".manifest.json") ? "manifest" : "html";
}

/**
 * `<wcs-state src=...>` の外部 state を HTML ファイルのディレクトリ基準で読む reader。
 * 読めないパス(不存在 / 権限)は undefined = 従来どおりスキップ(検証は
 * 「候補ゼロなら沈黙」の保守側に倒れる)。static-wiring-dx-design.md §6-2。
 *
 * 読まないもの(undefined 固定):
 * - スキーム付き URL(`https://...` 等)と protocol-relative(`//host/...`) —
 *   ネットワーク参照であり、Windows では `//h/s` が resolve で UNC パスに化けて
 *   readFileSync が SMB 接続(NTLM 送出・タイムアウト待ち)を起こす。静的検証
 *   ツールはネットワークに出ない。
 * - 先頭 `/` の絶対パス — ランタイムでは Web ルート基準であり、ファイルシステムの
 *   ルートに写像すると無関係なファイルを読みうる。Web ルートは設定なしに決められない。
 */
export function createFileReader(htmlPath: string, read: (path: string) => string = (p) => readFileSync(p, "utf8")): FileReader {
  const base = dirname(htmlPath);
  // 同一ファイルは validator 3 つ + .ts プローブで最大 6 回要求される。メモ化で
  // I/O を 1 回に抑え、validator 間で読む内容が変わる TOCTOU も同時に消す。
  const cache = new Map<string, string | undefined>();
  return (relativePath: string) => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(relativePath) || relativePath.startsWith("/")) {
      return undefined;
    }
    if (cache.has(relativePath)) {
      return cache.get(relativePath);
    }
    let content: string | undefined;
    try {
      content = read(resolve(base, relativePath));
      // PowerShell の Out-File 等が書く UTF-8 BOM は JSON.parse を黙って壊すので剥がす。
      if (content.charCodeAt(0) === 0xfeff) {
        content = content.slice(1);
      }
    } catch {
      content = undefined;
    }
    cache.set(relativePath, content);
    return content;
  };
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
  const { options, files } = parseArgs(argv);
  const locale = resolveCliLocale(options.locale);
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
    const kind = classify(path);
    inputs.push({ source: path, text, kind, fileReader: kind === "html" ? createFileReader(path) : undefined });
  }

  const result = runValidation(inputs, { ...options, locale });
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
// テスト(vitest = ESM)からの import では typeof require が "undefined" になるため
// この分岐は踏まない。
declare const require: NodeRequire | undefined;
declare const module: NodeModule | undefined;
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

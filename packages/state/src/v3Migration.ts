/**
 * v3Migration.ts — 3.0 で拒否される書き方・意味が変わる使い方の予告（次期メジャーの要件 D2）。
 *
 * 3.0 は互換層を持たない代わりに、2.x の最後の minor（2.6）でランタイムと lint が同じ書き方を
 * 名指しで知らせる。ここは 2.x の挙動を何も変えず、同じ文面の警告を 1 回だけ出す
 * （`[wcs/v3-migration]`）。文面は 3.0 での扱いと書き換え先だけを短く言い、2.x との差の一覧は
 * README に任せる（全文がランタイムのバンドルに載るため）。
 *
 * 文法の検査は**ランタイムの入口**（bindings/getParseBindTextResults.ts）で行い、パーサには
 * 入れない — 正本パーサは tooling（lint の言語サーバー）も使うので、そこで console に出すと
 * 言語サーバーのログに漏れる。判定そのものは v3MigrationRules.ts（lint と共有の純関数）。
 */
import type { ParseBindTextResult } from "./bindTextParser/types";
import { findEmbeddedV3MigrationIssues, findFilterArityIssues, findV3MigrationIssues } from "./v3MigrationRules";

const warned = new Set<string>();
/** 調べ終えた bindText（行の複製ごとに同じ文字列を調べ直さない） */
const checked = new Set<string>();

/** 同じ文面は 1 回だけ警告する（文面は書き方とサイトを含むので、書き方・サイトごとに 1 回） */
export function warnV3Migration(message: string): void {
  if (warned.has(message)) {
    return;
  }
  warned.add(message);
  console.warn(`[@wcstack/state] [wcs/v3-migration] ${message} See "Preparing for 3.0" in the @wcstack/state README.`);
}

/** readonly のプロキシからの書き込み（$resolve の書き込み形・$setAll）。3.0 は拒否する（要件 B6） */
export const READONLY_WRITE = 'A write through a readonly state ($resolve with a value, $setAll): 3.0 throws. Write from createState("writable", …).';

/** テスト用: 警告済みの台帳を空にする */
export function clearV3MigrationWarningsForTesting(): void {
  warned.clear();
  checked.clear();
}

function report(issues: readonly string[]): void {
  issues.forEach(warnV3Migration);
}

/** `data-wcs` の値を調べ、3.0 が拒否する（または意味を変える）書き方を知らせる */
export function checkBindTextForV3(bindText: string, results: readonly ParseBindTextResult[]): void {
  if (checked.has(bindText)) return;
  checked.add(bindText);
  for (const expr of bindText.split(";")) {
    report(findV3MigrationIssues(expr.trim()));
  }
  report(findFilterArityIssues(results));
}

/** mustache / コメントのテキストバインディング（右辺だけ）を調べる */
export function checkEmbeddedBindTextForV3(bindText: string, result: ParseBindTextResult): void {
  // 属性の値と同じ文字列でも経路が違うので、鍵を分ける
  const key = "{{" + bindText;
  if (checked.has(key)) return;
  checked.add(key);
  report(findEmbeddedV3MigrationIssues(bindText, result));
}

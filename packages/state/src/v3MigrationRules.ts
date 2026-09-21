/**
 * v3MigrationRules.ts — 3.0 で拒否される（または読み方が変わる）書き方の判定。純関数。
 *
 * ランタイム（v3Migration.ts が `[wcs/v3-migration]` として console に 1 回ずつ出す）と
 * tooling（`@wcstack/state/parser` 経由で lint が同じ判定を使う）の共通の正本。
 * ここは console に何も出さず、2.x の挙動も変えない（次期メジャーの要件 D2）。
 * 文面は短く保つ — 全文はランタイムのバンドルに載る。2.x との差と書き換え先の一覧は
 * state README の "Preparing for 3.0"（警告の末尾が案内する）。
 *
 * 式は 2.x の分割（`;` で無条件に割る）のまま受け取る — 引用符の中の `;` は 2.x では既に壊れている。
 */
import type { ParseBindTextResult } from "./bindTextParser/types";

// 組み込みフィルタの引数の上限。正本は filters/filterMeta.ts の maxArgs だが、説明文ごとランタイムに
// 載せないためここに畳む（一致はテストが固定する）。2.x の組み込みに無い名前はパーサが先に拒否する。
// 配列リテラルで書く — split() の呼び出しは副作用ありとみなされ、defineState だけの import に残る。
const NO_ARGS = new Set([
  "not", "abs", "uc", "lc", "cap", "trim", "rev", "int", "float", "date", "time", "datetime",
  "falsy", "truthy", "boolean", "number", "string", "null",
]);
const TWO_ARGS = new Set(["clamp", "slice", "substr", "pad", "truncate"]);

/** 組み込みフィルタ name が受け取る引数の上限 */
export function maxFilterArgs(name: string): number {
  return NO_ARGS.has(name) ? 0 : TWO_ARGS.has(name) ? 2 : 1;
}

const STRUCTURAL_KEYWORDS = new Set<string>(["for", "if", "elseif", "else", "..."]);

/**
 * 引用符の無い true / false / null を 1 つだけ取る eq / ne / defaults。3.0 は型付きの値として読む（要件 B9）。
 * 2.x はフィルタに渡す前に引用符を剥がすので、値の側では `eq('true')` と区別できない — 原文で見る。
 */
const TYPED_LITERAL = /(?:^|\|)\s*(eq|ne|defaults)\s*\(\s*(true|false|null)\s*\)/g;

/** 閉じていない引用符があるか */
function hasUnterminatedQuote(text: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
    }
  }
  return quote !== null;
}

/** 右辺（とフィルタ）の判定。属性の式とテキストバインディングで共通 */
function checkStatePart(text: string, parsed: ParseBindTextResult | null, issues: string[]): void {
  if (hasUnterminatedQuote(text)) {
    issues.push(`"${text}": 3.0 rejects the unterminated quote.`);
  }
  for (const [, fnName, literal] of text.matchAll(TYPED_LITERAL)) {
    issues.push(`"${fnName}(${literal})": 3.0 reads an unquoted ${literal} as a ${literal === "null" ? "null" : "boolean"}, ` +
      `not the text. Write ${fnName}('${literal}') to keep the text.`);
  }
  if (parsed !== null) {
    issues.push(...findFilterArityIssues([parsed]));
  }
}

/** 解析済みのフィルタの引数の個数（3.0 は束縛計画の段で [wcs/filter-arity] として拒否する） */
export function findFilterArityIssues(results: readonly ParseBindTextResult[]): string[] {
  const issues: string[] = [];
  for (const result of results) {
    for (const filter of [...result.inFilters, ...result.outFilters]) {
      const max = maxFilterArgs(filter.filterName);
      if (filter.args.length > max) {
        issues.push(`"${filter.filterName}" takes at most ${max} argument(s); 3.0 rejects more.`);
      }
    }
  }
  return issues;
}

/**
 * `data-wcs` の式 1 つ（`;` を含まない、trim 済み）の判定。`parsed` があればフィルタの引数の個数も見る。
 * 区切りの無い式は 2.x のパーサが先に拒否するので何も言わない。
 */
export function findV3MigrationIssues(expr: string, parsed: ParseBindTextResult | null = null): string[] {
  const issues: string[] = [];
  const colon = expr.indexOf(":");
  if (colon === -1) return issues;
  const propPart = expr.slice(0, colon).trim();
  const modifierParts = propPart.split("#");
  const keyword = modifierParts[0].split("|")[0].trim();
  if (modifierParts.length > 2) {
    issues.push(`"${propPart}": 3.0 rejects a second "#". Write "${modifierParts[0].trim()}#${modifierParts.slice(1).map((m) => m.trim()).join(",")}".`);
  }
  if (keyword === "else" && expr.slice(colon + 1).trim().length > 0) {
    issues.push(`"${expr}": 3.0 rejects a value after "else:".`);
  }
  if (STRUCTURAL_KEYWORDS.has(keyword) && keyword !== propPart) {
    issues.push(`"${propPart}": 3.0 rejects modifiers and filters on "${keyword}". Write "${keyword}:".`);
  }
  if ((keyword === "radio" || keyword === "checkbox") && keyword !== propPart) {
    issues.push(`"${propPart}": 3.0 keeps this a ${keyword} binding that honours the modifiers (2.x binds a property named "${keyword}").`);
  }
  checkStatePart(expr.slice(colon + 1).trim(), parsed, issues);
  return issues;
}

/** mustache / コメントのテキストバインディング（右辺だけ、`;` で割らない）の判定 */
export function findEmbeddedV3MigrationIssues(expression: string, parsed: ParseBindTextResult | null = null): string[] {
  const issues: string[] = [];
  checkStatePart(expression, parsed, issues);
  return issues;
}

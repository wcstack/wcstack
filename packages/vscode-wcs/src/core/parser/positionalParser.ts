/**
 * core/parser/positionalParser.ts — 正本パーサの tolerant・位置付きラッパー。
 *
 * 意味論は `@wcstack/state/parser`（ランタイムと同一実装の dist）を消費し、
 * このラッパーは正本が持たない 2 つだけを足す（static-wiring-dx-design.md D2/D3）:
 *
 * 1. **エラー耐性**: 正本は不正構文で throw する。ここでは式（`;` 区切り）単位で
 *    パースし、壊れた式は error として返して残りの式を生かす。
 * 2. **位置情報**: 正本の戻り値はオフセットを持たない。パース結果のトークン
 *    （propName / statePathName）を原文へ逆照合してスパンを返す。
 *
 * 分割規則は**ランタイムと同値**に保つ: `;` は無条件分割（正本パーサ自身の
 * `bindText.split(BINDING_SEPARATOR)` と同じ。既存の splitBindingExpressions は
 * 括弧深度を見るためランタイムより寛容で、乖離の既知源になっている）。
 * 区切り文字は manifest（`@wcstack/state/manifest`）から取り、リテラルを持たない。
 *
 * 注意: 「構造ディレクティブは単独バインディング」の検査は**属性全体**の性質で
 * あり、式単位のこのラッパーでは行わない。消費側が exprs.length と bindingType で
 * 判定すること（bindingValidator の structuralMustBeSingle が実装済み）。
 */

import {
  parseBindTextForEmbeddedNode,
  parseBindTextsForElement,
  type ParseBindTextResult,
} from '@wcstack/state/parser';
import { getWcsManifest } from '../../service/wcsManifest.js';

export interface ITokenRange {
  readonly start: number;
  readonly end: number;
}

export interface IPositionalBinding {
  /** trim 済みの式全体のスパン（入力 bindText 相対）。 */
  readonly exprRange: ITokenRange;
  /** trim 済みの式テキスト（exprRange が指す原文。トークン単位の再照合用）。 */
  readonly exprText: string;
  /** 正本パーサの結果。式が不正なら null。 */
  readonly parsed: ParseBindTextResult | null;
  /** 正本パーサの throw メッセージ（`[@wcstack/state]` プレフィックス込み）。成功時は null。 */
  readonly error: string | null;
  /** 左辺 propName のスパン（else / spread はキーワード自体）。特定不能なら null。 */
  readonly propRange: ITokenRange | null;
  /** 右辺パス（eventToken ではトークン名）のスパン。else 等パスを持たない式は null。 */
  readonly pathRange: ITokenRange | null;
}

const { delimiters } = getWcsManifest().syntax;

/** haystack の [from, to) 内で needle の trim 済みスパンを探す（見つからなければ null）。 */
function locate(haystack: string, needle: string, from: number, to: number): ITokenRange | null {
  if (needle.length === 0) return null;
  const index = haystack.indexOf(needle, from);
  if (index === -1 || index + needle.length > to) return null;
  return { start: index, end: index + needle.length };
}

/**
 * mustache / コメントバインディングの式を**ランタイムと同じ経路**
 * （parseBindTextForEmbeddedNode → parseStatePart）で位置付きパースする。
 *
 * 属性経路との決定的な違い: `;` を**分割しない**（`{{ a; b }}` は「a; b」という
 * 1 本のパス）。式全体が `path[@state][|filters]` の 1 バインディングで、
 * 左辺は合成（propName 'textContent'）のため propRange は常に null。
 * 入力 expression は templateSyntax の抽出結果（trim 済み）を想定する。
 */
export function parseEmbeddedTextWithPositions(expression: string): IPositionalBinding {
  const exprRange: ITokenRange = { start: 0, end: expression.length };

  let parsed: ParseBindTextResult | null = null;
  let error: string | null = null;
  try {
    parsed = parseBindTextForEmbeddedNode(expression);
  } catch (e) {
    error = (e as Error).message;
  }

  if (parsed === null) {
    return { exprRange, exprText: expression, parsed, error, propRange: null, pathRange: null };
  }

  // 右辺のみの式: パスは先頭から最初の `|` まで、`@state` はその窓内。
  const firstPipe = expression.indexOf(delimiters.filter);
  const pathScopeEnd = firstPipe === -1 ? expression.length : firstPipe;
  const pathLocal = locate(expression, parsed.statePathName, 0, pathScopeEnd);

  return {
    exprRange,
    exprText: expression,
    parsed,
    error,
    propRange: null,
    pathRange: pathLocal,
  };
}

/**
 * bindText 全体を式単位でパースし、位置付きの結果列を返す。
 * 空式（trim 後空。末尾セミコロン等）はランタイム同様スキップする。
 */
export function parseBindTextWithPositions(bindText: string): IPositionalBinding[] {
  const results: IPositionalBinding[] = [];
  const segments = bindText.split(delimiters.binding);
  let segmentStart = 0;

  for (const segment of segments) {
    const leading = segment.length - segment.trimStart().length;
    const expr = segment.trim();
    const exprStart = segmentStart + leading;
    segmentStart += segment.length + delimiters.binding.length;
    if (expr.length === 0) continue;

    const exprRange: ITokenRange = { start: exprStart, end: exprStart + expr.length };

    let parsed: ParseBindTextResult | null = null;
    let error: string | null = null;
    try {
      // 式単体を正本に渡す。式内に区切りは残っていないため結果は常に 1 件。
      parsed = parseBindTextsForElement(expr)[0] ?? null;
    } catch (e) {
      error = (e as Error).message;
    }

    if (parsed === null) {
      results.push({ exprRange, exprText: expr, parsed, error, propRange: null, pathRange: null });
      continue;
    }

    // --- トークンの逆照合（すべて式内オフセット → bindText オフセットへ持ち上げ） ---
    const colon = expr.indexOf(delimiters.propValue);
    const propEndLimit = colon === -1 ? expr.length : colon;

    // propName は propPart 先頭（trim 済み）に必ず現れる。in-filter（`value|number:`）
    // があっても propName は `|` より前なので先頭一致でよい。
    const propLocal = locate(expr, parsed.propName, 0, propEndLimit);

    let pathLocal: ITokenRange | null = null;
    if (colon !== -1) {
      const stateBase = colon + 1;
      const firstPipe = expr.indexOf(delimiters.filter, stateBase);
      const pathScopeEnd = firstPipe === -1 ? expr.length : firstPipe;
      // `#else` のような合成パス（原文に現れない）は locate が null を返す。
      pathLocal = locate(expr, parsed.statePathName, stateBase, pathScopeEnd);
    }

    const lift = (range: ITokenRange | null): ITokenRange | null =>
      range === null ? null : { start: exprStart + range.start, end: exprStart + range.end };

    results.push({
      exprRange,
      exprText: expr,
      parsed,
      error,
      propRange: lift(propLocal),
      pathRange: lift(pathLocal),
    });
  }

  return results;
}

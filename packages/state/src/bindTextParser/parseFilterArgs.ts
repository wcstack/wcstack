/**
 * フィルタ引数リストのパース。`filter(a, b)` の `a, b` 部分を受け取る。
 *
 * トリムの規則は「**クォートの外側だけ**」。`fix( 2 )` のような書き癖を吸収するために
 * 素の引数は前後をトリムするが、クォートは「ここは literal」という宣言なので中身の
 * 空白は残す。両方まとめてトリムしていたため `pad(5, ' ')` が空文字パディング
 * （＝無変化）に化けており、空白区切りの `join(' / ')` も指定できなかった。
 */

/** 引数 1 つを確定する。クォート由来の文字が入った範囲より外側だけをトリムする。 */
function finalizeArg(text: string, firstQuoteStart: number, lastQuoteEnd: number): string {
  // 先頭側: 最初のクォート文字より前だけが削れる（クォートが無ければ全体が対象）
  const startLimit = firstQuoteStart === -1 ? text.length : firstQuoteStart;
  let start = 0;
  while (start < startLimit && /\s/.test(text[start])) {
    start++;
  }
  // 末尾側: 最後のクォート文字より後ろだけが削れる（クォートが無ければ全体が対象）
  const endLimit = lastQuoteEnd === -1 ? 0 : lastQuoteEnd;
  let end = text.length;
  while (end > endLimit && /\s/.test(text[end - 1])) {
    end--;
  }
  return text.slice(start, end);
}

import { LINT_HINT } from "../errorGuidance";
import { raiseError } from "../raiseError";

/** 引用符の無い引数の型（要件 B9）: true / false / null / 数値は型付き、それ以外は文字列 */
const NUMBER_LITERAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function toLiteral(text: string, quoted: boolean): unknown {
  if (quoted) return text;
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  return NUMBER_LITERAL.test(text) ? Number(text) : text;
}

export function parseFilterArgs(argsText: string): string[] {
  return parseFilterArgsWithLiterals(argsText).args;
}

/** 引数の原文と、その型付きの値（要件 B9）を一緒に返す。原文は引用符を外したもの */
export function parseFilterArgsWithLiterals(argsText: string): { args: string[]; literals: unknown[] } {
  const args: string[] = [];
  const literals: unknown[] = [];
  let current = '';
  let inQuote: string | null = null;
  let hasQuote = false;
  let firstQuoteStart = -1;
  let lastQuoteEnd = -1;

  const flush = (): void => {
    const arg = finalizeArg(current, firstQuoteStart, lastQuoteEnd);
    args.push(arg);
    literals.push(toLiteral(arg, hasQuote));
    current = '';
    hasQuote = false;
    firstQuoteStart = -1;
    lastQuoteEnd = -1;
  };

  for (let i = 0; i < argsText.length; i++) {
    const char = argsText[i];

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        if (firstQuoteStart === -1) {
          firstQuoteStart = current.length;
        }
        current += char;
        lastQuoteEnd = current.length;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
      hasQuote = true;
    } else if (char === ',') {
      flush();
    } else {
      current += char;
    }
  }

  if (inQuote !== null) {
    // 閉じていない引用符は受理しない（要件 B2）。以前は黙って閉じたことにしていた
    raiseError(`[wcs/binding-syntax] unterminated ${inQuote} quote in the filter arguments "(${argsText})". Close the quote.${LINT_HINT}`);
  }
  const last = finalizeArg(current, firstQuoteStart, lastQuoteEnd);
  if (last || hasQuote) {
    args.push(last);
    literals.push(toLiteral(last, hasQuote));
  }

  return { args, literals };
}

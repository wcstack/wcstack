/**
 * フィルタ引数リストのパース。`filter(a, b)` の `a, b` 部分を受け取る。
 *
 * トリムの規則は「**クォートの外側だけ**」。`fix( 2 )` のような書き癖を吸収するために
 * 素の引数は前後をトリムするが、クォートは「ここは literal」という宣言なので中身の
 * 空白は残す。両方まとめてトリムしていたため `pad(5, ' ')` が空文字パディング
 * （＝無変化）に化けており、空白区切りの `join(' / ')` も指定できなかった。
 *
 * Port of `@wcstack/state` `src/bindTextParser/parseFilterArgs.ts` (behaviour unchanged).
 */
import { raise, M } from "../messages";

/** 引数 1 つを確定する。クォート由来の文字が入った範囲より外側だけをトリムする。 */
function finalizeArg(text: string, firstQuoteStart: number, lastQuoteEnd: number): string {
  // 先頭側: 最初のクォート文字より前だけが削れる（クォートが無ければ全体が対象）
  const startLimit = firstQuoteStart === -1 ? text.length : firstQuoteStart;
  // 末尾側: 最後のクォート文字より後ろだけが削れる（クォートが無ければ全体が対象）
  const endLimit = lastQuoteEnd === -1 ? 0 : lastQuoteEnd;
  // (`trim` removes what `\s` matches: WhiteSpace and LineTerminator)
  return text.slice(startLimit - text.slice(0, startLimit).trimStart().length, endLimit + text.slice(endLimit).trimEnd().length);
}

/** 引用符の無い引数の型（要件 B9）: true / false / null / 数値は型付き、それ以外は文字列 */
const NUMBER_LITERAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function toLiteral(text: string, quoted: boolean): unknown {
  if (quoted) return text;
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  return NUMBER_LITERAL.test(text) ? Number(text) : text;
}

/**
 * 引数の原文と、その型付きの値（要件 B9）を一緒に返す。原文は引用符を外したもの。
 *
 * 末尾の空引数だけが落ちる（`"a,"` → 1 個、`",a"` → 2 個、`","` → 1 個）。`filter()` を
 * 「引数 0 個」と読むための規則で、先頭・中間の空引数は位置を保つために残す。
 */
export function parseFilterArgsWithLiterals(argsText: string): { args: string[]; literals: unknown[] } {
  const args: string[] = [];
  const literals: unknown[] = [];
  let current = '';
  let inQuote: string | null = null;
  let hasQuote = false;
  let firstQuoteStart = -1;
  let lastQuoteEnd = -1;

  /** Ends an argument; only the last one is dropped when empty (and not quoted). */
  const flush = (last?: boolean): void => {
    const arg = finalizeArg(current, firstQuoteStart, lastQuoteEnd);
    if (!last || arg || hasQuote) {
      args.push(arg);
      literals.push(toLiteral(arg, hasQuote));
    }
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
    raise(M.UnterminatedQuote, [inQuote, argsText]);
  }
  flush(true);

  return { args, literals };
}

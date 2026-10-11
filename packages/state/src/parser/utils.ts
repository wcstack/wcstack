export const trimFn = (s: string): string => s.trim();

/**
 * The positions of `char` in `text` that are outside quotes (`'` / `"`), in order (要件 B1).
 * 閉じていない引用符はそのまま末尾まで続く扱い — 不正な引用符はフィルタ引数の段で名指しで落ちる。
 */
function outsideQuotes(text: string, char: string): number[] {
  const found: number[] = [];
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === char) {
      found.push(i);
    }
  }
  return found;
}

/** `text` の中で、引用符（`'` / `"`）の外にある最初の `char` の位置。無ければ -1（要件 B1）。 */
export const indexOfOutsideQuotes = (text: string, char: string): number => outsideQuotes(text, char)[0] ?? -1;

/**
 * `text` の中で、引用符の外にある**最後の** `char` の位置。無ければ -1（要件 B1）。
 * フィルタの閉じ括弧を探す用（`a|foo(')')` の引用符内の `)` を終端と誤認しないため）。
 */
export const lastIndexOfOutsideQuotes = (text: string, char: string): number => outsideQuotes(text, char).pop() ?? -1;

/**
 * `separator` で区切る。ただし引用符の中は区切らない（要件 B1）: `join(';')` や `join('|')` の
 * 区切り文字は引数であって、バインディングやフィルタの区切りではない。
 */
export function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (const i of outsideQuotes(text, separator)) {
    parts.push(text.slice(start, i));
    start = i + 1;
  }
  parts.push(text.slice(start));
  return parts;
}

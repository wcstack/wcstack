export const trimFn = (s: string): string => s.trim();

const isQuote = (c: string): boolean => c === "'" || c === '"';

/**
 * `text` の中で、引用符（`'` / `"`）の外にある最初の `char` の位置。無ければ -1（要件 B1）。
 * 閉じていない引用符はそのまま末尾まで続く扱い — 不正な引用符はフィルタ引数の段で名指しで落ちる。
 */
export function indexOfOutsideQuotes(text: string, char: string): number {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (isQuote(c)) {
      quote = c;
    } else if (c === char) {
      return i;
    }
  }
  return -1;
}

/**
 * `text` の中で、引用符の外にある**最後の** `char` の位置。無ければ -1（要件 B1）。
 * 引用符は前からしか追えないので、前向きに走査して最後の一致を控える。
 * フィルタの閉じ括弧を探す用（`a|foo(')')` の引用符内の `)` を終端と誤認しないため）。
 */
export function lastIndexOfOutsideQuotes(text: string, char: string): number {
  let quote: string | null = null;
  let found = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (isQuote(c)) {
      quote = c;
    } else if (c === char) {
      found = i;
    }
  }
  return found;
}

/**
 * `separator` で区切る。ただし引用符の中は区切らない（要件 B1）: `join(';')` や `join('|')` の
 * 区切り文字は引数であって、バインディングやフィルタの区切りではない。
 */
export function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (isQuote(c)) {
      quote = c;
    } else if (c === separator) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

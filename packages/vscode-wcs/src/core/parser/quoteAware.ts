/**
 * core/parser/quoteAware.ts — 引用符を見る走査のヘルパー（拡張内で 1 つだけ）。
 *
 * `data-wcs` の区切り文字はどれも**引用符の外**にあるものだけが区切り（要件 B1）:
 * バインディングの `;`・フィルタの `|`・左右を分ける `:`・フィルタ引数の `,`。
 * 引用符を見ずに切ると、`value|defaults(':'): name` は左辺が `value|defaults('` で切れ、
 * `items|join(', ')` は引数が 2 個に数えられて、どちらも **error 重大度の
 * `wcs/filter-arity` を誤報**する（`join(', ')` は要件 B1 の代表例そのもの）。
 *
 * 式の区切り（`;`）は正本の `splitBindTexts` に委譲できるが、`:` / `|` / `,` の分割は
 * 正本が内部で使うだけで公開 API になっていない版があるため、規則をここに 1 つだけ持つ。
 *
 * 正本: `@wcstack/state` の `bindTextParser/utils.ts` の `indexOfOutsideQuotes` /
 * `splitOutsideQuotes`。実装は 1:1 で写す（閉じていない引用符はそのまま末尾まで続く扱い —
 * 不正な引用符はフィルタ引数の段で名指しで落ちる）。
 *
 * TODO（次リリース）: `@wcstack/state/parser` が `indexOfOutsideQuotes` /
 * `splitOutsideQuotes` を export した dist をコミットしたら、このモジュールを消して正本へ
 * 委譲する（`splitBindTexts` と同じ形）。委譲は ESM の名前付き import なので、export を
 * 持たない dist に戻すと読み込み時に即死する（実際 3.2.0 のコミット済み dist は
 * `clearParserCaches / getPathInfo / parseBindTextForEmbeddedNode /
 * parseBindTextsForElement / splitBindTexts` しか持たない）。そのため
 * 「src では export 済み・dist は未反映」の期間は写しのままにしておく。
 *
 * pure（DOM / vscode 非依存）。依存を持たない（どの層からも import してよい）。
 */

const isQuote = (c: string): boolean => c === "'" || c === '"';

/**
 * `text` の中で、引用符（`'` / `"`）の外にある最初の `char` の位置。無ければ -1。
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
 * `separator` で区切る。ただし引用符の中は区切らない（要件 B1）:
 * `join(';')` / `join('|')` / `join(', ')` の区切り文字は引数であって、
 * バインディング・フィルタ・引数の区切りではない。
 * 前後の空白は残す（tooling が位置を数えられるように — 正本と同じ）。
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

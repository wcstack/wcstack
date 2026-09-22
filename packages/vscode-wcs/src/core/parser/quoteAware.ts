/**
 * core/parser/quoteAware.ts — 引用符を見る走査のヘルパー（拡張内で 1 つだけ）。
 *
 * `data-wcs` の左辺 / 右辺を分ける `:` は**引用符の外**にあるものだけ（要件 B1）。
 * `value|defaults(':'): name` の引数の `:` を区切りとして拾うと、左辺が
 * `value|defaults('` で切れてフィルタ引数が消え、`wcs/filter-arity`（引数 0 個）の
 * ような誤検出になる。式の区切り（`;`）は正本の `splitBindTexts` に委譲できるが、
 * `:` の分割は正本が内部で使うだけで公開 API になっていない版があるため、規則を
 * ここに 1 つだけ持つ。
 *
 * 正本: `@wcstack/state` の `bindTextParser/utils.ts` の `indexOfOutsideQuotes`。
 * 実装は 1:1 で写す（閉じていない引用符はそのまま末尾まで続く扱い — 不正な引用符は
 * フィルタ引数の段で名指しで落ちる）。
 *
 * TODO（次リリース）: `@wcstack/state/parser` が `indexOfOutsideQuotes` を export した
 * dist をコミットしたら、このモジュールを消して正本へ委譲する（`splitBindTexts` と同じ形）。
 * 委譲は ESM の名前付き import なので、export を持たない dist に戻すと読み込み時に即死する。
 * そのため「src では export 済み・dist は未反映」の期間は写しのままにしておく。
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

/**
 * bindingContext.ts
 *
 * data-wcs 属性値内のカーソル位置からバインディングコンテキストを解析する。
 * どの部分（プロパティ名、パス、フィルタ）の補完が必要かを判定する。
 */

import { indexOfOutsideQuotes, lastIndexOfOutsideQuotes, splitOutsideQuotes } from '../core/parser/quoteAware.js';

/** カーソル位置のバインディングコンテキスト */
export type BindingContext =
  | { kind: 'property'; partial: string }
  | { kind: 'modifier'; propName: string; partial: string }
  | { kind: 'path'; propName: string; partial: string }
  | { kind: 'filter'; propName: string; partial: string }
  | { kind: 'none' };

/**
 * data-wcs 属性値とカーソルのオフセットから補完コンテキストを解析する。
 *
 * バインディング構文: `[property][#modifier]: [path][|filter|filter(args)...]`
 * 複数バインディングは `;` で区切る（v1 の `@state` セレクタは v2 で撤去 —
 * `@` は検出だけして補完を止める。validator が parse error にする）。
 *
 * @param attrValue - data-wcs 属性の値全体
 * @param cursorOffset - 属性値内のカーソル位置（0始まり）
 */
export function getBindingContext(attrValue: string, cursorOffset: number): BindingContext {
  // カーソル位置を含むバインディング式を特定（`;` で分割）
  const bindings = splitBindings(attrValue);
  let currentStart = 0;
  let currentBinding = '';

  for (const binding of bindings) {
    const end = currentStart + binding.length;
    if (cursorOffset <= end) {
      currentBinding = binding;
      break;
    }
    // +1 for the `;` separator
    currentStart = end + 1;
  }

  if (!currentBinding && bindings.length > 0) {
    currentBinding = bindings[bindings.length - 1];
    currentStart = attrValue.length - currentBinding.length;
  }

  const offsetInBinding = cursorOffset - currentStart;
  return parseBindingAtCursor(currentBinding, offsetInBinding);
}

/**
 * `;` でバインディング式を分割する。区切りは**引用符の外**の `;` だけ（要件 B1・
 * ランタイムの `splitBindTexts` と同値）。以前は括弧深度だけを見ていたので、
 * `textContent: 'a;b'` のように括弧を伴わない引用符の中の `;` で割れ、カーソル位置の
 * 式を取り違えていた（実測: 末尾で `{ kind: 'property', partial: "b'" }`）。
 */
function splitBindings(value: string): string[] {
  return splitOutsideQuotes(value, ';');
}

/**
 * 単一のバインディング式とカーソル位置からコンテキストを判定する。
 */
function parseBindingAtCursor(binding: string, offset: number): BindingContext {
  const textBeforeCursor = binding.slice(0, offset);

  // `:` の位置を探す（プロパティ部とパス部の境界）。引用符の中の `:`
  // （`defaults(':')` の引数）は境界ではない — 正本 parseBindTextsForElement と同じ規則
  const colonIndex = indexOfOutsideQuotes(binding, ':');

  if (colonIndex === -1 || offset <= colonIndex) {
    // `:` の前（プロパティ部）。修飾子の区切り `#` も引用符の外だけ — 左辺の入力フィルタの
    // 引数に `#` があると（`value|defaults('#')`）、素の走査ではプロパティ補完のはずが
    // イベント修飾子の補完になり、propName も `value|defaults('` というゴミになる
    const trimmed = textBeforeCursor.trimStart();
    const hashIndex = indexOfOutsideQuotes(trimmed, '#');
    if (hashIndex !== -1) {
      return {
        kind: 'modifier',
        propName: trimmed.slice(0, hashIndex),
        partial: trimmed.slice(hashIndex + 1),
      };
    }
    return { kind: 'property', partial: trimmed };
  }

  // プロパティ名を抽出（`#modifier` を除去）。`#` は引用符の外だけ（上と同じ理由）
  const propPart = binding.slice(0, colonIndex).trim();
  const propHash = indexOfOutsideQuotes(propPart, '#');
  const propName = propHash === -1 ? propPart : propPart.slice(0, propHash);

  // `:` の後（パス + フィルタ部）
  const afterColon = textBeforeCursor.slice(colonIndex + 1).trimStart();

  // `@` は v2 の parse error（名前次元は撤去）— 検出だけして補完を止める
  const firstPipeIndex = indexOfOutsideQuotes(afterColon, '|');
  const pathPart = firstPipeIndex !== -1 ? afterColon.slice(0, firstPipeIndex) : afterColon;
  const atIndex = pathPart.indexOf('@');

  // `|` があればフィルタ部。区切りは引用符の外だけ — 素の `lastIndexOf` だと
  // `textContent: items|join('|')` の末尾で引数の中の `|` を拾い、`')` をフィルタ名の
  // 入力中として補完してしまう（実測）。入力途中で引用符が開きっぱなしのとき
  // （`join('`）は、その先が全部「引用符の中」になるので手前の実区切りが選ばれる。
  const lastPipeIndex = lastIndexOfOutsideQuotes(afterColon, '|');
  if (lastPipeIndex !== -1) {
    const filterPart = afterColon.slice(lastPipeIndex + 1).trimStart();
    // 括弧内の場合はフィルタ引数（補完しない）
    if (filterPart.includes('(') && !filterPart.includes(')')) {
      return { kind: 'none' };
    }
    return { kind: 'filter', propName, partial: filterPart };
  }

  // `@` を含む式は壊れている（v2 parse error）— 補完しない
  if (atIndex !== -1) {
    return { kind: 'none' };
  }

  return { kind: 'path', propName, partial: afterColon };
}

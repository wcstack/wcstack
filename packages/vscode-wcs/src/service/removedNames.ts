/**
 * removedNames.ts — `@wcstack/state` 3.2 で改名し、4.0 で外した旧名（要件 D4・B12）。
 *
 * 4.0 のランタイムは旧名を受け付けない:
 *   - フィルタの旧名（`uc` など）と `substr` は `[wcs/filter-unknown]`（登録簿に無い）
 *   - API の旧名（`this.$trackDependency`）は読んだ時点で `[wcs/name-alias]` #1701
 *   - 宣言キーの旧名（`$streams`・`$updatedCallback`）は読み込み時に `[wcs/declaration-alias]` #1601
 *
 * 4.0 の manifest の旧名の表（`filterAliases` / `declarationAliases` / `apiAliases`）は空 —
 * ランタイムが受け付けない名前を配る理由が無いため。拡張は**移行の案内**のために 3.x の表を
 * ここに凍結して持つ（3.x は閉じた系なので正本とずれない）。4.0 の正本との整合（旧名が 4.0 の
 * 語彙に無いこと・正式名が 4.0 の語彙にあること・ランタイムが同じ旧名を拒むこと）は
 * `__tests__/nameAliases.drift.test.ts` が固定する。
 */

import type { WcsMessageCatalog } from '../core/messages.js';

/** フィルタの旧名 → 正式名（3.x の `filters/filterAliases.ts` の写し）。 */
export const REMOVED_FILTER_NAMES: Readonly<Record<string, string>> = Object.freeze({
  inc: 'add',
  dec: 'sub',
  fix: 'toFixed',
  uc: 'upper',
  lc: 'lower',
  cap: 'capitalize',
  rep: 'repeat',
  rev: 'reverse',
  pad: 'padStart',
  null: 'nullIfEmpty',
});

/** API の旧名 → 正式名（3.x の manifest の `STATE_API_ALIASES` の写し）。 */
export const REMOVED_API_NAMES: Readonly<Record<string, string>> = Object.freeze({
  $trackDependency: '$dependOn',
  $untrackDependency: '$untracked',
});

/** 宣言キーの旧名 → 正式名（3.x の `declarationAliases.ts` の `DECLARATION_ALIASES` の写し）。 */
export const REMOVED_DECLARATION_KEYS: Readonly<Record<string, string>> = Object.freeze({
  $streams: '$stream',
  $updatedCallback: '$renderedCallback',
});

/** 4.0 が外したフィルタ（改名ではなく統合）。`substr(start, length)` は `slice(start, end)` に一本化した。 */
export const SUBSTR_FILTER = 'substr';

const own = (table: Readonly<Record<string, string>>, name: string): string | null =>
  Object.prototype.hasOwnProperty.call(table, name) ? table[name] : null;

/** フィルタの旧名なら正式名、そうでなければ null。 */
export function removedFilterReplacement(name: string): string | null {
  return own(REMOVED_FILTER_NAMES, name);
}

/** API の旧名なら正式名、そうでなければ null。 */
export function removedApiReplacement(name: string): string | null {
  return own(REMOVED_API_NAMES, name);
}

/** 宣言キーの旧名なら正式名、そうでなければ null。 */
export function removedDeclarationReplacement(name: string): string | null {
  return own(REMOVED_DECLARATION_KEYS, name);
}

/**
 * `substr(start, length)` の書き換え先。引数が 2 つとも数値リテラルで start が 0 以上なら
 * `slice(start, start + length)` を計算して返す（`substr(2, 3)` → `slice(2, 5)`）。それ以外は null
 * （負の start は文字列の長さによって `slice(start)` と `slice(start, start + length)` が分かれるので、
 * 具体形を出さず一般形だけを案内する）。
 */
export function substrRewrite(args: readonly string[]): string | null {
  if (args.length !== 2) return null;
  const [start, length] = args.map((a) => a.trim());
  if (!/^\d+$/.test(start) || !/^-?\d+$/.test(length)) return null;
  const s = Number(start);
  return `slice(${s}, ${s + Number(length)})`;
}

/**
 * 4.0 の組み込みに無いフィルタ名が、4.0 で外れた名前ならその案内（`wcs/filter-unknown` の文面）。
 * 外れた名前でなければ null（呼び手は通常の「組み込みに存在しない」を出す）。
 * 4.0 の組み込みにある名前かどうかは呼び手が先に manifest で引く — ここは外れた名前の表だけを見る。
 */
export function removedFilterMessage(name: string, args: readonly string[], msgs: WcsMessageCatalog): string | null {
  if (name === SUBSTR_FILTER) return msgs.substrRemoved(substrRewrite(args));
  const canonical = removedFilterReplacement(name);
  return canonical === null ? null : msgs.filterRemoved(name, canonical);
}

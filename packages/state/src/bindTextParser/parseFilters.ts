import { clearFilterResolutionCache } from "../core/filterRegistry";
import { MODIFIER_SEPARATOR } from "../define";
import { LINT_HINT } from "../errorGuidance";
import { FilterIOType } from "../filters/types";
import { raiseError } from "../raiseError";
import { IParsedFilter } from "../types";
import { parseFilterArgsWithLiterals } from "./parseFilterArgs";

/** tooling 専用（parser.ts の clearParserCaches からのみ呼ぶ）。 */
export function clearFilterFnCacheForTooling(): void {
  clearFilterResolutionCache();
}

// format: filterName(arg1,arg2) or filterName

/**
 * 文法の段（要件 D16）: 名前と引数だけを読む。**実関数は引かない** — 束縛計画の段で
 * 登録簿から解決する（`core/filterRegistry.ts`・`bindings/getBindingInfos.ts`）。
 * 未知のフィルタもここでは落とさない: パーサだけを使う tooling は実装を持たないので、
 * 「知らない名前」を解析の段で判定できない。
 */
/**
 * @param filterTextList 個々のフィルタの原文（`|` で切った後）
 * @param _filterIOType  入力 / 出力（実関数は引かないので現状は使わない）
 * @param sourceText     診断に埋める原文。省略時は `filterTextList` を `|` でつなぎ直したもの
 *                       （`textContent: a|` のように末尾が空だと、つなぎ直しでは文脈が消える）
 */
export function parseFilters(filterTextList: string[], _filterIOType: FilterIOType, sourceText?: string): IParsedFilter[] {
  const source = sourceText ?? filterTextList.join("|");
  return filterTextList.map((filterText) => {
    const openParenIndex = filterText.indexOf('(');
    const closeParenIndex = filterText.lastIndexOf(')');
    // check parentheses
    if (openParenIndex !== -1 && closeParenIndex === -1) {
      raiseError(`[wcs/binding-syntax] Invalid filter format: missing closing parenthesis in "${filterText}".${LINT_HINT}`);
    }
    if (closeParenIndex !== -1 && openParenIndex === -1) {
      raiseError(`[wcs/binding-syntax] Invalid filter format: missing opening parenthesis in "${filterText}".${LINT_HINT}`);
    }
    const filterName = (openParenIndex === -1 ? filterText : filterText.substring(0, openParenIndex)).trim();
    if (filterName.length === 0) {
      // 空のフィルタ（`x|`・`x||y`・`x|(1)`）は文法の誤り。解析の段で名指しで落とす — 未知の
      // フィルタとは別物で、実関数の解決（束縛計画の段）まで持ち越すと tooling の解析が素通りする
      raiseError(`[wcs/binding-syntax] an empty filter in "${source}" — remove the extra "|" or name the filter.${LINT_HINT}`);
    }
    if (filterName.includes(MODIFIER_SEPARATOR)) {
      // `value|trim#ro:` — 左辺は「名前 → 修飾子 → 入力フィルタ」の順。修飾子がフィルタ名に
      // 飲まれると `[wcs/filter-unknown] filter not found: trim#ro` になり、診断が指す先が
      // 実際の誤りと違う（要件 B4 の並び）
      const [name, modifiers] = filterName.split(MODIFIER_SEPARATOR);
      raiseError(
        `[wcs/binding-syntax] "${filterName}" is not a filter name: a modifier list "${MODIFIER_SEPARATOR}${modifiers}" ` +
        `comes before the filters, not inside one — write "…${MODIFIER_SEPARATOR}${modifiers}|${name}".${LINT_HINT}`,
      );
    }
    if (openParenIndex === -1) {
      // no arguments
      return { filterName, args: [], literals: [] };
    }
    const argsText = filterText.substring(openParenIndex + 1, closeParenIndex);
    return { filterName, ...parseFilterArgsWithLiterals(argsText) };
  });
}

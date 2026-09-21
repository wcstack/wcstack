import { clearFilterResolutionCache } from "../core/filterRegistry";
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
export function parseFilters(filterTextList: string[], _filterIOType: FilterIOType): IParsedFilter[] {
  return filterTextList.map((filterText) => {
    const openParenIndex = filterText.indexOf('(');
    const closeParenIndex = filterText.lastIndexOf(')');
    // check parentheses
    if (openParenIndex !== -1 && closeParenIndex === -1) {
      raiseError(`Invalid filter format: missing closing parenthesis in "${filterText}"`);
    }
    if (closeParenIndex !== -1 && openParenIndex === -1) {
      raiseError(`Invalid filter format: missing opening parenthesis in "${filterText}"`);
    }
    if (openParenIndex === -1) {
      // no arguments
      return { filterName: filterText.trim(), args: [], literals: [] };
    }
    const argsText = filterText.substring(openParenIndex + 1, closeParenIndex);
    const filterName = filterText.substring(0, openParenIndex).trim();
    return { filterName, ...parseFilterArgsWithLiterals(argsText) };
  });
}

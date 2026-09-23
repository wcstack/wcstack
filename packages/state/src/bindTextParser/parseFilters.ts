import { clearFilterResolutionCache } from "../core/filterRegistry";
import { MODIFIER_SEPARATOR } from "../define";
import { LINT_HINT } from "../errorGuidance";
import { FilterIOType } from "../filters/types";
import { raiseError } from "../raiseError";
import { IParsedFilter } from "../types";
import { parseFilterArgsWithLiterals } from "./parseFilterArgs";
import { indexOfOutsideQuotes, lastIndexOfOutsideQuotes } from "./utils";

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
 * @param filterIOType   入力（左辺）/ 出力（右辺）。実関数は引かないが、助言の出し分けに使う
 * @param sourceText     診断に埋める原文。呼び出し側は**その辺の全文**（`propPart` / `statePart`）を
 *                       渡すこと。`|` より後ろだけを渡すと、`textContent: a|` のように末尾が空の形で
 *                       空文字になり、つなぎ直し（`filterTextList.join("|")`）と同じで文脈が消える。
 *                       省略時のつなぎ直しは、原文を持たない直接の呼び出し用のフォールバック
 */
export function parseFilters(filterTextList: string[], filterIOType: FilterIOType, sourceText?: string): IParsedFilter[] {
  const source = sourceText ?? filterTextList.join("|");
  return filterTextList.map((filterText) => {
    // 括弧も引用符の外だけで探す（要件 B1）。素の `indexOf` / `lastIndexOf` だと
    // `foo(')')` の引用符内の `)` を終端に取り、「閉じ括弧が無い」ではなく
    // 「引用符が閉じていない」という見当違いの診断になっていた
    const openParenIndex = indexOfOutsideQuotes(filterText, '(');
    let closeParenIndex = lastIndexOfOutsideQuotes(filterText, ')');
    if (closeParenIndex === -1) {
      // 引用符の外に閉じ括弧が無い ＝ 引用符が閉じていない形（`join('x)`）か、本当に無いか。
      // 前者で「閉じ括弧が無い」と言うのは見当違いなので素の探索へ落とし、引数の段の
      // `[wcs/binding-syntax] unterminated ' quote` に診断させる
      closeParenIndex = filterText.lastIndexOf(')');
    }
    // check parentheses
    if (openParenIndex !== -1 && closeParenIndex === -1) {
      raiseError(`[wcs/binding-syntax] Invalid filter format: missing closing parenthesis in "${filterText}".${LINT_HINT}`);
    }
    if (closeParenIndex !== -1 && openParenIndex === -1) {
      raiseError(`[wcs/binding-syntax] Invalid filter format: missing opening parenthesis in "${filterText}".${LINT_HINT}`);
    }
    if (closeParenIndex !== -1 && closeParenIndex < openParenIndex) {
      // `foo)1(` — 以前は `substring` が start > end で引数を入れ替えるため、フィルタ名
      // `foo)1` として受理されていた
      raiseError(`[wcs/binding-syntax] Invalid filter format: ")" comes before "(" in "${filterText}".${LINT_HINT}`);
    }
    if (closeParenIndex !== -1 && filterText.slice(closeParenIndex + 1).trim().length > 0) {
      // 閉じ括弧の後ろの残余を**黙って捨てていた**。`n|fix(2)uc` は `uc` が消えて診断ゼロで
      // 通り、括弧の無い `n|ucuc` は `[wcs/filter-unknown]` で落ちる — 括弧の有無で非対称だった。
      // 実害は「`|` の打ち忘れでフィルタが 1 本消えても無診断」
      const trailing = filterText.slice(closeParenIndex + 1).trim();
      raiseError(
        `[wcs/binding-syntax] "${filterText}": unexpected "${trailing}" after the filter's closing ")" — ` +
        `separate filters with "|" (write "${filterText.slice(0, closeParenIndex + 1)}|${trailing}").${LINT_HINT}`,
      );
    }
    const filterName = (openParenIndex === -1 ? filterText : filterText.substring(0, openParenIndex)).trim();
    if (filterName.length === 0) {
      // 空のフィルタ（`x|`・`x||y`・`x|(1)`）は文法の誤り。解析の段で名指しで落とす — 未知の
      // フィルタとは別物で、実関数の解決（束縛計画の段）まで持ち越すと tooling の解析が素通りする
      raiseError(`[wcs/binding-syntax] an empty filter in "${source}" — remove the extra "|" or name the filter.${LINT_HINT}`);
    }
    if (filterName.includes(MODIFIER_SEPARATOR)) {
      // フィルタ名に `#` が飲まれた形。`[wcs/filter-unknown] filter not found: trim#ro` だと
      // 診断が指す先が実際の誤りと違う（要件 B4 の並び）。
      // 助言は辺で分ける — **修飾子は左辺にしか存在しない**ので、右辺で「修飾子をフィルタより
      // 前に書け」と言うと成立しない直し方（`textContent#ro|trim: x`）を勧めることになる
      const [name, modifiers] = filterName.split(MODIFIER_SEPARATOR);
      raiseError(filterIOType === "input"
        ? `[wcs/binding-syntax] "${filterName}" is not a filter name: a modifier list ` +
          `"${MODIFIER_SEPARATOR}${modifiers}" comes before the input filters, not inside one — write ` +
          `"<property>${MODIFIER_SEPARATOR}${modifiers}|${name}".${LINT_HINT}`
        : `[wcs/binding-syntax] "${filterName}" is not a filter name: "${MODIFIER_SEPARATOR}" cannot appear ` +
          `in one. Modifiers belong on the left side of the binding, before the ":" — write "${name}" ` +
          `here.${LINT_HINT}`);
    }
    if (openParenIndex === -1) {
      // no arguments
      return { filterName, args: [], literals: [] };
    }
    const argsText = filterText.substring(openParenIndex + 1, closeParenIndex);
    return { filterName, ...parseFilterArgsWithLiterals(argsText) };
  });
}

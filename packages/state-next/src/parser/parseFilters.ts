import { MODIFIER_SEPARATOR } from "./define";
import { parseFilterArgsWithLiterals } from "./parseFilterArgs";
import { raise, M } from "../messages";
import { FilterIOType, ParsedFilter } from "./types";
import { indexOfOutsideQuotes, lastIndexOfOutsideQuotes } from "./utils";

// format: filterName(arg1,arg2) or filterName

/**
 * 文法の段（要件 D16）: 名前と引数だけを読む。**実関数は引かない** — フィルタ名の解決
 * （別名も含む）はエンジン側の仕事。未知のフィルタもここでは落とさない。
 *
 * Port of `@wcstack/state` `src/bindTextParser/parseFilters.ts` (behaviour unchanged; the
 * tooling-only `clearFilterFnCacheForTooling` is dropped).
 *
 * @param filterTextList 個々のフィルタの原文（`|` で切った後）
 * @param filterIOType   入力（左辺）/ 出力（右辺）。実関数は引かないが、助言の出し分けに使う
 * @param sourceText     診断に埋める原文。呼び出し側は**その辺の全文**（`propPart` / `statePart`）を
 *                       渡すこと。`|` より後ろだけを渡すと、`textContent: a|` のように末尾が空の形で
 *                       空文字になり、つなぎ直し（`filterTextList.join("|")`）と同じで文脈が消える。
 *                       省略時のつなぎ直しは、原文を持たない直接の呼び出し用のフォールバック
 */
export function parseFilters(filterTextList: string[], filterIOType: FilterIOType, sourceText?: string): ParsedFilter[] {
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
      raise(M.FilterUnclosed, [filterText]);
    }
    if (closeParenIndex !== -1 && openParenIndex === -1) {
      raise(M.FilterUnopened, [filterText]);
    }
    if (closeParenIndex !== -1 && closeParenIndex < openParenIndex) {
      // `foo)1(` — 以前は `substring` が start > end で引数を入れ替えるため、フィルタ名
      // `foo)1` として受理されていた
      raise(M.FilterParenOrder, [filterText]);
    }
    if (closeParenIndex !== -1 && filterText.slice(closeParenIndex + 1).trim().length > 0) {
      // 閉じ括弧の後ろの残余を**黙って捨てていた**。`n|fix(2)uc` は `uc` が消えて診断ゼロで
      // 通っていた。実害は「`|` の打ち忘れでフィルタが 1 本消えても無診断」
      const trailing = filterText.slice(closeParenIndex + 1).trim();
      raise(M.FilterTrailing, [filterText, trailing]);
    }
    const filterName = (openParenIndex === -1 ? filterText : filterText.substring(0, openParenIndex)).trim();
    if (filterName.length === 0) {
      // 空のフィルタ（`x|`・`x||y`・`x|(1)`）は文法の誤り。解析の段で名指しで落とす — 未知の
      // フィルタとは別物で、実関数の解決まで持ち越すと tooling の解析が素通りする
      raise(M.FilterEmpty, [source]);
    }
    if (filterName.includes(MODIFIER_SEPARATOR)) {
      // フィルタ名に `#` が飲まれた形。`[wcs/filter-unknown] filter not found: trim#ro` だと
      // 診断が指す先が実際の誤りと違う（要件 B4 の並び）。
      // 助言は辺で分ける — **修飾子は左辺にしか存在しない**ので、右辺で「修飾子をフィルタより
      // 前に書け」と言うと成立しない直し方（`textContent#ro|trim: x`）を勧めることになる
      const [, modifiers] = filterName.split(MODIFIER_SEPARATOR);
      raise(filterIOType === "input" ? M.FilterNameHasModifiersInput : M.FilterNameHasModifiersOutput, [filterName, modifiers]);
    }
    if (openParenIndex === -1) {
      // no arguments
      return { filterName, args: [], literals: [] };
    }
    const argsText = filterText.substring(openParenIndex + 1, closeParenIndex);
    return { filterName, ...parseFilterArgsWithLiterals(argsText) };
  });
}

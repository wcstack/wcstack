import { IParsedFilter } from "../types";

/**
 * `if` / `else` の反転として、エンジン自身がパース結果へ足すフィルタ（解析の段の形 —
 * 名前と引数だけ。要件 D16）。実関数は束縛計画の段で登録簿から引かれる。
 *
 * `not` は core（`core/filterRegistry.ts` の `CORE_FILTERS`）と `features/formats`
 * （`formats/builtinFilters.ts`）が**同じ実装**（`!value`）を持つので、formats を入れない
 * 分割 core のページでも、入れたページでも同じ答えになる。ここが食い違うと
 * `if: 0` に対する `else:` がどちらの枝も描かれない（`applyChangeToIf` は `Boolean()` で
 * 寄せるのに `not` が非 boolean で throw していた）。
 */
let _notFilterInfo: IParsedFilter | undefined = undefined;

export function createNotFilter(): IParsedFilter {
  return _notFilterInfo ??= { filterName: "not", args: [] };
}

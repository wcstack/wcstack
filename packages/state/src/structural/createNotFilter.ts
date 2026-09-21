import { IParsedFilter } from "../types";

/**
 * `if` / `else` の反転として、エンジン自身がパース結果へ足すフィルタ（解析の段の形 —
 * 名前と引数だけ。要件 D16）。実関数は束縛計画の段で登録簿から引かれ、`not` は
 * `features/formats` の有無に関わらず core が答える（`core/filterRegistry.ts`）。
 */
let _notFilterInfo: IParsedFilter | undefined = undefined;

export function createNotFilter(): IParsedFilter {
  return _notFilterInfo ??= { filterName: "not", args: [] };
}

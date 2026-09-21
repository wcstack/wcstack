/**
 * bindings/planFilters.ts — 束縛計画の段でフィルタの実関数を引く（要件 D16）。
 *
 * 解析の段（`bindTextParser/parseFilters.ts`）は名前と引数しか作らない。実関数は
 * 登録簿（`core/filterRegistry.ts`）から**ここで**引く。未知のフィルタが名指しで落ちるのも
 * ここ — ページの構築時であって、最初の更新の最中ではない。
 *
 * 呼び出し点は 2 つ: 通常経路の `getBindingInfos`（ノードごと）と、行プラン
 * `structural/rowPlan.ts`（テンプレートごとに 1 回、行不変の解決として焼き込む）。
 */
import type { ParseBindTextResult } from "../bindTextParser/types";
import { resolveFilterFn } from "../core/filterRegistry";
import type { FilterIOType } from "../filters/types";
import type { IBindingInfo, IFilterInfo, IParsedFilter } from "../types";

/** node / replaceNode 以外が確定したバインディング（行プランのスロットが持つ形） */
export type IPlannedBinding = Omit<IBindingInfo, "node" | "replaceNode">;

export function planFilters(filters: IParsedFilter[], filterIOType: FilterIOType): IFilterInfo[] {
  if (filters.length === 0) {
    // 空配列は共有してよい（フィルタ無しの宣言が大多数）
    return filters as IFilterInfo[];
  }
  const planned: IFilterInfo[] = [];
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i];
    planned.push({
      filterName: filter.filterName,
      args: filter.args,
      filterFn: resolveFilterFn(filter.filterName, filter.args, filterIOType),
    });
  }
  return planned;
}

export function planBinding(parsed: ParseBindTextResult): IPlannedBinding {
  return {
    ...parsed,
    inFilters: planFilters(parsed.inFilters, "input"),
    outFilters: planFilters(parsed.outFilters, "output"),
  };
}

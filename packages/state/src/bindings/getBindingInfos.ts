import { IBindingInfo, IFilterInfo, IParsedFilter } from "../types";
import { ParseBindTextResult } from "../bindTextParser/types";
import { resolveFilterFn } from "../core/filterRegistry";
import { FilterIOType } from "../filters/types";

/**
 * 束縛計画の段でフィルタの実関数を引く（要件 D16）。解析の段は名前と引数しか持たないので、
 * 未知のフィルタが名指しで落ちるのはここ — ページの構築時であって、最初の更新の最中ではない。
 * 解決済みの答えは登録簿が名前・引数・入出力ごとに 1 つ持つ（`core/filterRegistry.ts`）。
 */
function planFilters(filters: IParsedFilter[], filterIOType: FilterIOType): IFilterInfo[] {
  if (filters.length === 0) {
    return filters as IFilterInfo[];
  }
  const planned: IFilterInfo[] = [];
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i];
    planned.push({
      filterName: filter.filterName,
      args: filter.args,
      filterFn: resolveFilterFn(filter.filterName, filter.args, filterIOType, filter.literals ?? filter.args),
    });
  }
  return planned;
}

export function getBindingInfos(node: Node, parseBindingTextResults: ParseBindTextResult[]): IBindingInfo[] {
  const bindingInfos: IBindingInfo[] = [];
  for (const parseBindingTextResult of parseBindingTextResults) {
    const inFilters = planFilters(parseBindingTextResult.inFilters, "input");
    const outFilters = planFilters(parseBindingTextResult.outFilters, "output");
    if (parseBindingTextResult.bindingType !== 'text') {
      bindingInfos.push({
        ...parseBindingTextResult,
        inFilters,
        outFilters,
        node: node,
        replaceNode: node,
      });
    } else {
      // フラグメント登録時に事前正規化済みの Text ノードはそのまま replaceNode に
      // 使う（node === replaceNode なら replaceToReplaceNode は no-op）。
      // 実 DOM 上の wcs-text コメント（非フラグメント経路）は従来どおり
      // 空 Text を生成して実行時に差し替える。
      const replaceNode = node.nodeType === Node.TEXT_NODE
        ? node
        : document.createTextNode('');
      bindingInfos.push({
        ...parseBindingTextResult,
        inFilters,
        outFilters,
        node: node,
        replaceNode: replaceNode,
      });
    }
  }
  return bindingInfos;
}

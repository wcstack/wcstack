import { IPathInfo } from "../address/types";
import { FilterFn } from "../filters/types";

export type BindingType = 'text' | 'prop' | 'event' | 'for' | 'if' | 'elseif' | 'else' | 'radio' | 'checkbox' | 'spread';

/**
 * 文法の段が読むフィルタ（名前と引数だけ。要件 D16）。実関数は束縛計画の段で
 * 登録簿から解決される（`core/filterRegistry.ts`）ので、パース結果はここで止まる。
 */
export interface IParsedFilter {
  readonly filterName: string;
  readonly args: string[];
}

/** 束縛計画の段で実関数まで解決したフィルタ */
export interface IFilterInfo extends IParsedFilter {
  readonly filterFn: FilterFn;
}

/**
 * バインディング式のパース結果（DOM 非依存の部分）。`@wcstack/state/parser` の
 * ParseBindTextResult がこれをそのまま公開するため、Node 等の DOM lib 型を
 * ここに足してはならない（足すなら IBindingInfo 側へ）。
 */
export interface IParsedBinding {
  readonly propName: string;
  readonly propSegments: string[];
  readonly propModifiers: string[];
  readonly statePathName: string;
  readonly statePathInfo: IPathInfo;
  readonly inFilters: IParsedFilter[];
  readonly outFilters: IParsedFilter[];
  readonly bindingType: BindingType;
  readonly uuid?: string | null; // for 'for', 'if', 'elseif', 'else' bindings
}

/**
 * 束縛計画の段のバインディング。パース結果に DOM のノードと、**解決済みのフィルタ**が付く
 * （`bindings/getBindingInfos.ts` が登録簿から引く — 要件 D16）。
 */
export interface IBindingInfo extends IParsedBinding {
  readonly inFilters: IFilterInfo[];
  readonly outFilters: IFilterInfo[];
  readonly node: Node; // raw node
  readonly replaceNode: Node; // replaced node or raw node
}

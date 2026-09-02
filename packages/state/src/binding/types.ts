import { IPathInfo } from "../address/types";
import { FilterFn } from "../filters/types";

export type BindingType = 'text' | 'prop' | 'event' | 'for' | 'if' | 'elseif' | 'else' | 'radio' | 'checkbox' | 'spread';

export interface IFilterInfo {
  readonly filterName: string;
  readonly args: string[];
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
  readonly inFilters: IFilterInfo[];
  readonly outFilters: IFilterInfo[];
  readonly bindingType: BindingType;
  readonly uuid?: string | null; // for 'for', 'if', 'elseif', 'else' bindings
}

export interface IBindingInfo extends IParsedBinding {
  readonly node: Node; // raw node
  readonly replaceNode: Node; // replaced node or raw node
}

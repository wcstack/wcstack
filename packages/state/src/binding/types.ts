import { IAbsolutePathInfo, IPathInfo } from "../address/types";
import { FilterFn } from "../filters/types";

export type BindingType = 'text' | 'prop' | 'event' | 'for' | 'if' | 'elseif' | 'else';

export interface IFilterInfo {
  readonly filterName: string;
  readonly args: string[];
  readonly filterFn: FilterFn;
}

export interface IBindingInfo {
  readonly propName: string;
  readonly propSegments: string[];
  readonly propModifiers: string[];
  readonly statePathName: string;
  readonly statePathInfo: IPathInfo;
  readonly stateName: string;
  readonly stateAbsolutePathInfo: IAbsolutePathInfo;
  readonly inFilters: IFilterInfo[];
  readonly outFilters: IFilterInfo[];
  readonly node: Node; // raw node
  readonly replaceNode: Node; // replaced node or raw node
  readonly bindingType: BindingType;
  readonly uuid?: string | null; // for 'for', 'if', 'elseif', 'else' bindings
}

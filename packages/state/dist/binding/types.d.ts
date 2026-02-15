import { IPathInfo } from "../address/types";
import { FilterFn } from "../filters/types";
export type BindingType = 'text' | 'prop' | 'event' | 'for' | 'if' | 'elseif' | 'else' | 'radio' | 'checkbox';
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
    readonly inFilters: IFilterInfo[];
    readonly outFilters: IFilterInfo[];
    readonly node: Node;
    readonly replaceNode: Node;
    readonly bindingType: BindingType;
    readonly uuid?: string | null;
}
//# sourceMappingURL=types.d.ts.map
import { IPathInfo } from "../address/types";
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
    readonly statePathInfo: IPathInfo | null;
    readonly stateName: string;
    readonly filters: IFilterInfo[];
    readonly node: Node;
    readonly replaceNode: Node;
    readonly bindingType: BindingType;
    readonly uuid?: string | null;
}
//# sourceMappingURL=types.d.ts.map
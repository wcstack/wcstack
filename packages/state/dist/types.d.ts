import { IPathInfo } from "./address/types";
import { FilterFn } from "./filters/types";
export interface IState {
    [key: string]: any;
}
export interface ITagNames {
    state: string;
}
export interface IConfig {
    bindAttributeName: string;
    commentTextPrefix: string;
    commentForPrefix: string;
    commentIfPrefix: string;
    commentElseIfPrefix: string;
    commentElsePrefix: string;
    tagNames: ITagNames;
    locale: string;
}
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
    readonly placeHolderNode: Node;
    readonly bindingType: BindingType;
    readonly uuid?: string | null;
}
export interface ILoopContent {
    readonly firstNode: Node | null;
    readonly lastNode: Node | null;
    mountAfter(targetNode: Node): void;
    unmount(): void;
}
//# sourceMappingURL=types.d.ts.map
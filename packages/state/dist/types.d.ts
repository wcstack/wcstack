import { IPathInfo } from "./address/types";
import { IStateElement } from "./components/types";
export interface IState {
    [key: string]: any;
}
export interface ITagNames {
    state: string;
    cond: string;
    loop: string;
}
export interface IConfig {
    bindAttributeName: string;
    tagNames: ITagNames;
}
export interface IBindingInfo {
    readonly propName: string;
    readonly propSegments: string[];
    readonly propModifiers: string[];
    readonly statePathName: string;
    readonly statePathInfo: IPathInfo;
    readonly stateName: string;
    readonly stateElement: IStateElement;
    readonly filterTexts: string[];
    readonly node: Node;
}
export interface ILoopContent {
    readonly firstNode: Node | null;
    readonly lastNode: Node | null;
    mountAfter(targetNode: Node): void;
    unmount(): void;
}
//# sourceMappingURL=types.d.ts.map
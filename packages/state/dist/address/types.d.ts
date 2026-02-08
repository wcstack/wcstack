import { IListIndex } from "../list/types";
export interface IPathInfo {
    readonly id: number;
    readonly path: string;
    readonly segments: string[];
    readonly lastSegment: string;
    readonly cumulativePaths: string[];
    readonly cumulativePathSet: Set<string>;
    readonly cumulativePathInfos: IPathInfo[];
    readonly cumulativePathInfoSet: Set<IPathInfo>;
    readonly parentPath: string | null;
    readonly parentPathInfo: IPathInfo | null;
    readonly wildcardPaths: string[];
    readonly wildcardPathSet: Set<string>;
    readonly indexByWildcardPath: Record<string, number>;
    readonly wildcardPathInfos: IPathInfo[];
    readonly wildcardPathInfoSet: Set<IPathInfo>;
    readonly wildcardParentPaths: string[];
    readonly wildcardParentPathSet: Set<string>;
    readonly wildcardParentPathInfos: IPathInfo[];
    readonly wildcardParentPathInfoSet: Set<IPathInfo>;
    readonly wildcardPositions: number[];
    readonly lastWildcardPath: string | null;
    readonly lastWildcardInfo: IPathInfo | null;
    readonly wildcardCount: number;
}
export interface IStateAddress {
    readonly pathInfo: IPathInfo;
    readonly listIndex: IListIndex | null;
    readonly parentAddress: IStateAddress | null;
}
export interface IAbsolutePathInfo {
    readonly stateName: string;
    readonly pathInfo: IPathInfo;
    readonly parentAbsolutePathInfo: IAbsolutePathInfo | null;
}
export interface IAbsoluteStateAddress {
    readonly absolutePathInfo: IAbsolutePathInfo;
    readonly listIndex: IListIndex | null;
    readonly parentAbsoluteAddress: IAbsoluteStateAddress | null;
}
export type WildcardType = "none" | "context" | "partial" | "all";
export interface IResolvedAddress {
    readonly path: string;
    readonly segments: string[];
    readonly paths: string[];
    readonly wildcardType: WildcardType;
    readonly wildcardIndexes: (number | null)[];
    /** Reference to the structured pattern information this resolved path is based on */
    readonly pathInfo: IPathInfo;
}
//# sourceMappingURL=types.d.ts.map
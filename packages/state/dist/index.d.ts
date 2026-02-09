declare function bootstrapState(): void;

declare function waitForStateInitialize(root: Document | Element | DocumentFragment): Promise<void>;

declare function convertMustacheToComments(root: Document | Element | DocumentFragment): void;

declare function collectStructuralFragments(root: Document | Element | DocumentFragment, forPath?: string): void;

interface IPathInfo {
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
interface IStateAddress {
    readonly pathInfo: IPathInfo;
    readonly listIndex: IListIndex | null;
    readonly parentAddress: IStateAddress | null;
}

/**
 * Interface for hierarchical loop index management in nested loops.
 * Tracks parent-child relationships, versions, and provides access to index hierarchy.
 */
interface IListIndex {
    readonly parentListIndex: IListIndex | null;
    readonly uuid: string;
    readonly position: number;
    readonly length: number;
    index: number;
    readonly version: number;
    readonly dirty: boolean;
    readonly indexes: number[];
    readonly listIndexes: WeakRef<IListIndex>[];
    readonly varName: string;
    at(position: number): IListIndex | null;
}
interface ILoopContext extends IStateAddress {
    readonly pathInfo: IPathInfo;
    readonly listIndex: IListIndex;
}

declare function initializeBindings(root: Document | Element, parentLoopContext: ILoopContext | null): void;

export { bootstrapState, collectStructuralFragments, convertMustacheToComments, initializeBindings, waitForStateInitialize };

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

/**
 * Filter/types.ts
 *
 * Type definition file for filter functions.
 *
 * Main responsibilities:
 * - Defines types for filter functions (FilterFn) and filter functions with options (FilterWithOptionsFn)
 * - Type-safe management of filter name-to-function mappings (FilterWithOptions) and filter function arrays (Filters)
 * - Defines types for retrieving filter functions from built-in filter collections
 *
 * Design points:
 * - Type design enabling flexible filter design and extension
 * - Supports filters with options and combinations of multiple filters
 */
type FilterFn<T = unknown> = (value: unknown) => T;

type BindingType = 'text' | 'prop' | 'event' | 'for' | 'if' | 'elseif' | 'else' | 'radio' | 'checkbox' | 'spread';
interface IFilterInfo {
    readonly filterName: string;
    readonly args: string[];
    readonly filterFn: FilterFn;
}
/**
 * バインディング式のパース結果（DOM 非依存の部分）。`@wcstack/state/parser` の
 * ParseBindTextResult がこれをそのまま公開するため、Node 等の DOM lib 型を
 * ここに足してはならない（足すなら IBindingInfo 側へ）。
 */
interface IParsedBinding {
    readonly propName: string;
    readonly propSegments: string[];
    readonly propModifiers: string[];
    readonly statePathName: string;
    readonly statePathInfo: IPathInfo;
    readonly stateName: string;
    readonly inFilters: IFilterInfo[];
    readonly outFilters: IFilterInfo[];
    readonly bindingType: BindingType;
    readonly uuid?: string | null;
}

type ParseBindTextResult = IParsedBinding;

declare function parseBindTextsForElement(bindText: string): ParseBindTextResult[];

declare function getPathInfo(path: string): IPathInfo;

export { getPathInfo, parseBindTextsForElement };
export type { BindingType, IFilterInfo, IPathInfo, ParseBindTextResult };

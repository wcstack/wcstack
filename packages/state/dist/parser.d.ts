type BindingType = 'text' | 'prop' | 'event' | 'for' | 'if' | 'elseif' | 'else' | 'radio' | 'checkbox' | 'spread';
/**
 * A filter as the grammar reads it: name and arguments only. The filter function is resolved
 * later by the engine (the parser never looks names up, so unknown names pass here).
 *
 * Field names are the ones of `@wcstack/state`'s `IParsedFilter`:
 * - `filterName` — the name as written (no alias resolution).
 * - `args`       — the raw argument texts, quotes removed (format filters read these).
 * - `literals`   — the typed value of each argument (requirement B9): unquoted `true` / `false` /
 *                  `null` / numbers are typed, everything else (and every quoted argument) is the string.
 *                  Always the same length and order as `args`.
 */
interface ParsedFilter {
    filterName: string;
    args: string[];
    literals: unknown[];
}
/** Parse result of one binding (DOM independent). */
interface ParsedBinding {
    propName: string;
    propSegments: string[];
    propModifiers: string[];
    statePathName: string;
    inFilters: ParsedFilter[];
    outFilters: ParsedFilter[];
    bindingType: BindingType;
}

/**
 * `data-wcs` の値をバインディングごとに区切る（前後の空白は残す — tooling が位置を数えられるように）。
 * 引用符の中の `;` は区切りではない（要件 B1 — `join(';')`）。
 */
declare function splitBindTexts(bindText: string): string[];

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
declare function getPathInfo(path: string): IPathInfo;

/** `text` の中で、引用符（`'` / `"`）の外にある最初の `char` の位置。無ければ -1（要件 B1）。 */
declare const indexOfOutsideQuotes: (text: string, char: string) => number;
/**
 * `separator` で区切る。ただし引用符の中は区切らない（要件 B1）: `join(';')` や `join('|')` の
 * 区切り文字は引数であって、バインディングやフィルタの区切りではない。
 */
declare function splitOutsideQuotes(text: string, separator: string): string[];

/** One parsed binding: the parser's fields and its path's info. */
interface ParseBindTextResult extends ParsedBinding {
    readonly statePathInfo: IPathInfo;
    /** 3.x gave structural bindings an id here; the new engine does not use one. */
    readonly uuid?: string | null;
}
/** A filter resolved to its function (what the engine plans; the parser gives name and arguments). */
interface IFilterInfo extends ParsedFilter {
    readonly filterFn: (value: unknown) => unknown;
}
/** A `data-wcs` attribute's text → its bindings. */
declare function parseBindTextsForElement(bindText: string): ParseBindTextResult[];
/** A `{{ … }}` expression → its (text) binding. */
declare function parseBindTextForEmbeddedNode(bindText: string): ParseBindTextResult;
/**
 * Drops this entry's caches (interned path infos, parsed filters). For long-running processes
 * (a language server): half-typed paths would otherwise stay interned. After a clear,
 * getPathInfo returns a new instance for the same path.
 */
declare function clearParserCaches(): void;

export { clearParserCaches, getPathInfo, indexOfOutsideQuotes, parseBindTextForEmbeddedNode, parseBindTextsForElement, splitBindTexts, splitOutsideQuotes };
export type { BindingType, IFilterInfo, IPathInfo, ParseBindTextResult };

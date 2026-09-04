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
    readonly inFilters: IFilterInfo[];
    readonly outFilters: IFilterInfo[];
    readonly bindingType: BindingType;
    readonly uuid?: string | null;
}

type ParseBindTextResult = IParsedBinding;

declare function parseBindTextsForElement(bindText: string): ParseBindTextResult[];

declare function parseBindTextForEmbeddedNode(bindText: string): ParseBindTextResult;

declare function getPathInfo(path: string): IPathInfo;

/**
 * parser.ts — `data-wcs` バインディング構文の正本パーサを tooling 向けに公開する
 * サブパスエントリ（`@wcstack/state/parser`）。
 *
 * `./manifest` と同じ「実装が唯一の正本」パターン（docs/static-wiring-dx-design.md D2）。
 * vscode-wcs の正規表現パーサ・devtools の declaredScan 簡易パーサという複製実装を
 * 段階的にこの正本へ寄せるための土台。
 *
 * 契約:
 * - DOM 非依存・純関数（bindText 文字列 → ParseBindTextResult[]）。Node でそのまま動く
 *   （__tests__/parser.test.ts が node 環境で検証する）。
 * - **位置情報は持たず、不正構文は raiseError で throw する**。エラー耐性と診断 range の
 *   生成は消費側（vscode-wcs の positional ラッパー）の責務（同 D3）— ランタイムの
 *   サイズと責務をここで増やさない。
 * - `getPathInfo` はパス文字列の解析済みビュー（セグメント・ワイルドカード位置・親パス
 *   チェーン）を返す純関数。静的依存グラフの親チェーン展開はこの情報から機械的に再現できる。
 *   同一パス → 同一インスタンスの保証は**このエントリのモジュールインスタンス内**でのみ
 *   成立する（`.` エントリは別バンドル＝別キャッシュ。ランタイムの PathInfo と identity
 *   比較してはならない）。キャッシュは無制限（evict なし）— 言語サーバー等の長時間
 *   プロセスでは入力パス種数に単調比例してメモリが増える点に留意。
 * - `ParseBindTextResult.uuid` はランタイム内部（構造テンプレートのハイドレーション台帳）
 *   用のフィールドで、このパーサの戻り値では常に undefined。
 *
 * 公開面は意図的に最小（公開＝恒久契約）。`expandSpread` は live Element と
 * CustomElementRegistry を要するためここには含めない — ブラウザ内の消費者
 * （devtools の declared 正本化）は state 自身が pull API で答える。
 */

/**
 * このエントリの内部キャッシュ（PathInfo intern・propPart/statePart のパース結果・フィルタ関数クロージャ）を全て捨てる。
 *
 * 言語サーバー等の**長時間プロセス専用**。編集中の中間パス（`user.n` 等）が
 * 無制限キャッシュに恒久 intern されてメモリが単調増加するため、ドキュメント
 * クローズ等の区切りで呼ぶ。クリア後の getPathInfo は同一パスに**新しい**
 * インスタンスを返す — 「同一パス → 同一参照」の保証はクリアを跨がない。
 * ランタイム（`.` エントリ）にはこの API は無く、呼ばれることもない。
 */
declare function clearParserCaches(): void;

export { clearParserCaches, getPathInfo, parseBindTextForEmbeddedNode, parseBindTextsForElement };
export type { BindingType, IFilterInfo, IPathInfo, ParseBindTextResult };

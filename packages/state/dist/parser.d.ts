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

type BindingType = 'text' | 'prop' | 'event' | 'for' | 'if' | 'elseif' | 'else' | 'radio' | 'checkbox' | 'spread';
/**
 * 文法の段が読むフィルタ（名前と引数だけ。要件 D16）。実関数は束縛計画の段で
 * 登録簿から解決される（`core/filterRegistry.ts`）ので、パース結果はここで止まる。
 */
interface IParsedFilter {
    readonly filterName: string;
    readonly args: string[];
    /**
     * 引数の型付きの値（要件 B9）。引用符の無い `true` / `false` / `null` / 数値は型付き、引用符付きは
     * 文字列のまま。`args` は引用符を外した原文（書式フィルタはこちらを読む）。組み立てた側が省略したら
     * `args` と同じ扱い。
     */
    readonly literals?: readonly unknown[];
}
/** 束縛計画の段で実関数まで解決したフィルタ */
interface IFilterInfo extends IParsedFilter {
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
    readonly inFilters: IParsedFilter[];
    readonly outFilters: IParsedFilter[];
    readonly bindingType: BindingType;
    readonly uuid?: string | null;
}

type ParseBindTextResult = IParsedBinding;

/**
 * `data-wcs` の値をバインディングごとに区切る（前後の空白は残す — tooling が位置を数えられるように）。
 * 引用符の中の `;` は区切りではない（要件 B1 — `join(';')`）。ランタイムと tooling（`@wcstack/state/parser`）で共有する
 */
declare function splitBindTexts(bindText: string): string[];
declare function parseBindTextsForElement(bindText: string): ParseBindTextResult[];

/**
 * `text` の中で、引用符（`'` / `"`）の外にある最初の `char` の位置。無ければ -1（要件 B1）。
 * 閉じていない引用符はそのまま末尾まで続く扱い — 不正な引用符はフィルタ引数の段で名指しで落ちる。
 */
declare function indexOfOutsideQuotes(text: string, char: string): number;
/**
 * `separator` で区切る。ただし引用符の中は区切らない（要件 B1）: `join(';')` や `join('|')` の
 * 区切り文字は引数であって、バインディングやフィルタの区切りではない。
 */
declare function splitOutsideQuotes(text: string, separator: string): string[];

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
 *   プロセスではメモリが増え続ける点に留意（断ち方は `clearPathInfoCacheForTooling`）。
 *   **増え方はパス種数への単調比例ではない**: `PathInfo` は自分の全ての接頭辞を intern
 *   するので、1 本のパスが持ち込む量はその深さの 2 乗に比例する。深さは
 *   `MAX_PATH_SEGMENTS` で頭打ちになる（超えたパスは `[wcs/binding-syntax]` で拒否）。
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

export { clearParserCaches, getPathInfo, indexOfOutsideQuotes, parseBindTextForEmbeddedNode, parseBindTextsForElement, splitBindTexts, splitOutsideQuotes };
export type { BindingType, IFilterInfo, IPathInfo, ParseBindTextResult };

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
interface ILoopContextStack {
    createLoopContext(elementStateAddress: IStateAddress, callback: (loopContext: ILoopContext) => void | Promise<void>): void | Promise<void>;
}

declare const setLoopContextAsyncSymbol: unique symbol;
declare const setLoopContextSymbol: unique symbol;
declare const getByAddressSymbol: unique symbol;
declare const hasByAddressSymbol: unique symbol;
declare const setByAddressSymbol: unique symbol;
declare const connectedCallbackSymbol: unique symbol;
declare const disconnectedCallbackSymbol: unique symbol;
declare const updatedCallbackSymbol: unique symbol;

interface IStateProxy extends IState {
    [setLoopContextAsyncSymbol](loopContext: ILoopContext | null, callback: () => Promise<any>): Promise<any>;
    [setLoopContextSymbol](loopContext: ILoopContext | null, callback: () => any): any;
    [getByAddressSymbol](address: IStateAddress): any;
    [hasByAddressSymbol](address: IStateAddress): boolean;
    [setByAddressSymbol](address: IStateAddress, value: any): void;
    [connectedCallbackSymbol](): Promise<void>;
    [disconnectedCallbackSymbol](): void;
    [updatedCallbackSymbol](updatedAbsAddressList: IAbsoluteStateAddress[]): void;
}
type Mutability = "readonly" | "writable";

interface IStateElement {
    readonly name: string;
    readonly initializePromise: Promise<void>;
    readonly connectedCallbackPromise: Promise<void>;
    readonly listPaths: Set<string>;
    readonly elementPaths: Set<string>;
    readonly getterPaths: Set<string>;
    readonly setterPaths: Set<string>;
    readonly loopContextStack: ILoopContextStack;
    readonly dynamicDependency: Map<string, string[]>;
    readonly staticDependency: Map<string, string[]>;
    readonly version: number;
    readonly rootNode: Node;
    readonly boundComponentStateProp: string | null;
    readonly bindableEventMap: Record<string, string>;
    readonly commandTokenNames: ReadonlySet<string>;
    readonly eventTokenNames: ReadonlySet<string>;
    /**
     * state が $updatedCallback を定義しているか。false のとき drain は更新
     * アドレスの集計と最終の writable createState を丸ごとスキップできる。
     * optional なのはテスト用モック互換のため（undefined は「不明＝集計する」）。
     */
    readonly hasUpdatedCallback?: boolean;
    /**
     * 他行を読む getter（隣接項目参照など）が検出されたリストパスの集合。
     * これらのリストは walkDependency の diff-filter 展開の対象外（全行展開）。
     * optional なのはテスト用モック互換のため（undefined は「検出なし」扱い）。
     */
    readonly crossRowListPaths?: ReadonlySet<string>;
    addCrossRowListPath?(path: string): void;
    /**
     * 評価中に $1 等のインデックスを読んだ getter パスの集合（実行時検出）。
     * 位置だけが変わった行（listDiff.changeIndexSet）は index 以外の入力が不変なので、
     * walkDependency の静的子展開をこの集合の subtree に限定できる。
     * optional なのはテスト用モック互換のため（undefined は「検出なし」扱い）。
     */
    readonly indexDependentGetterPaths?: ReadonlySet<string>;
    addIndexDependentGetterPath?(path: string): void;
    setPathInfo(path: string, bindingType: BindingType): void;
    addStaticDependency(parentPath: string, childPath: string): boolean;
    addDynamicDependency(fromPath: string, toPath: string): boolean;
    createStateAsync(mutability: Mutability, callback: (state: IStateProxy) => Promise<void>): Promise<void>;
    createState(mutability: Mutability, callback: (state: IStateProxy) => void): void;
    nextVersion(): number;
    bindProperty(prop: string, desc: PropertyDescriptor): void;
    setInitialState(state: Record<string, any>): void;
}

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
interface IAbsolutePathInfo {
    readonly stateName: string;
    readonly stateElement: IStateElement;
    readonly pathInfo: IPathInfo;
    readonly parentAbsolutePathInfo: IAbsolutePathInfo | null;
}
interface IAbsoluteStateAddress {
    readonly absolutePathInfo: IAbsolutePathInfo;
    readonly listIndex: IListIndex | null;
    readonly parentAbsoluteAddress: IAbsoluteStateAddress | null;
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
interface IBindingInfo {
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

interface IState {
    [key: string]: any;
}
interface ITagNames {
    readonly state: string;
    readonly ssr: string;
}
interface IWritableTagNames {
    state?: string;
    ssr?: string;
}
interface IConfig {
    readonly bindAttributeName: string;
    readonly commentTextPrefix: string;
    readonly commentForPrefix: string;
    readonly commentIfPrefix: string;
    readonly commentElseIfPrefix: string;
    readonly commentElsePrefix: string;
    readonly tagNames: ITagNames;
    readonly locale: string;
    readonly debug: boolean;
    readonly enableMustache: boolean;
    /**
     * Enables direction-aware initial synchronization (`init=` / `sync=`).
     * Disabled by default while Phase 2 is evaluated against existing snapshots.
     */
    readonly enableDirectionalInitialSync: boolean;
    /**
     * Enables causal propagation tracking (transaction / edge provenance /
     * write receipts). Disabled by default while Phase 3 runs as a shadow of
     * the primitive same-value guard.
     */
    readonly enablePropagationContext: boolean;
    /**
     * Enables the opt-in dev-time contract analyzer (Phase 5b). When false
     * (default), `analyzeContract()` is a no-op with zero cost — runtime
     * behavior and allocation are unchanged. When true, it checks the actually
     * loaded `static wcBindable` declarations against a supplied sidecar
     * manifest and emits `contract:*` drift trace via the DevTools sink.
     */
    readonly enableContractAnalyzer: boolean;
    /**
     * 同値ガード（**既定 true**・標準的リアクティブ挙動・`setConfig({ sameValueGuard: false })` で opt-out 可）。
     * primitive 値の set で `Object.is` 同値なら更新を no-op にする
     * （enqueue / 依存 walk / DOM 適用 / $updatedCallback / DCC イベントを発火しない）。
     * 参照型（object/array）は in-place mutation 取りこぼし防止のため素通し。
     * 同値 set に副作用（同値時の $updatedCallback 等）を期待する場合は false にする。
     */
    readonly sameValueGuard: boolean;
}
interface IWritableConfig {
    bindAttributeName?: string;
    commentTextPrefix?: string;
    commentForPrefix?: string;
    commentIfPrefix?: string;
    commentElseIfPrefix?: string;
    commentElsePrefix?: string;
    tagNames?: IWritableTagNames;
    locale?: string;
    debug?: boolean;
    enableMustache?: boolean;
    enableDirectionalInitialSync?: boolean;
    enablePropagationContext?: boolean;
    enableContractAnalyzer?: boolean;
    sameValueGuard?: boolean;
}

declare function bootstrapState(config?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * 指定された rootNode のバインディング初期化が完了するまで待機する Promise を返す。
 */
declare function getBindingsReady(rootNode: Node): Promise<void>;

/**
 * Browser builds use the native HTMLElement. Headless runtimes receive an
 * inert base so the public module can be imported without installing DOM
 * globals; constructing components remains a browser-only operation.
 */
declare const HTMLElementBase: typeof HTMLElement;

interface ISsrElement {
    readonly name: string;
    readonly version: string;
    readonly stateData: IState;
    readonly templates: Map<string, HTMLTemplateElement>;
    readonly hydrateProps: Record<string, Record<string, unknown>>;
    getTemplate(uuid: string): HTMLTemplateElement | null;
    verifyVersion(): boolean;
}
declare class Ssr extends HTMLElementBase implements ISsrElement {
    private _stateData;
    private _templates;
    private _hydrateProps;
    get name(): string;
    get version(): string;
    get stateData(): IState;
    get templates(): Map<string, HTMLTemplateElement>;
    get hydrateProps(): Record<string, Record<string, unknown>>;
    getTemplate(uuid: string): HTMLTemplateElement | null;
    /**
     * サーバーの SSR バージョンとクライアントの state バージョンを検証する。
     * メジャー・マイナーバージョンが一致すればtrue。
     * version 属性がない場合は検証スキップ（true）。
     */
    verifyVersion(): boolean;
    setStateData(data: IState): void;
    setHydrateProps(props: Record<string, Record<string, unknown>>): void;
    private _loadStateData;
    private _loadTemplates;
    private _loadHydrateProps;
    static findByName(root: Node, name: string): ISsrElement | null;
    /**
     * stateData と構造テンプレート・プロパティから <wcs-ssr> の中身を構築する。
     * server パッケージの renderToString から呼ばれる。
     */
    /**
     * wcs-state 要素から $ プレフィックスや関数を除いたデータを抽出する。
     */
    static extractStateData(stateEl: Element): Record<string, any>;
    static buildContent(ssrEl: Element, stateData: Record<string, any>): void;
    /**
     * SSR ブロック境界コメント (@@wcs-*-start/end) を除去する
     */
    static removeBlockBoundaryComments(root: Node): void;
    /**
     * SSR の構造プレースホルダーコメント (@@wcs-for:uuid 等) を除去する
     */
    static removeStructuralComments(root: Node): void;
    /**
     * SSR テキストバインディングコメントを復元する。
     * <!--@@wcs-text-start:path-->text<!--@@wcs-text-end:path-->
     * → <!--@@: path--> (バインディングシステムが認識する形式)
     */
    static restoreTextBindings(root: Node): void;
    /**
     * SSR DOM をクリーンアップし、buildBindings が動作できる状態に戻す。
     * バージョン不一致時のフォールバック用。
     *
     * 1. SSR ブロック境界コメント間のレンダリング済みノードを除去
     * 2. SSR テキストバインディングを @@: 形式に復元
     * 3. プレースホルダーコメントを <wcs-ssr> 内のテンプレートで差し替え
     * 4. data-wcs-ssr-id 属性を除去
     * 5. <wcs-ssr> を除去
     */
    static cleanupDom(root: Document): void;
}

declare function buildBindings(root: Document | ShadowRoot): Promise<void>;

/**
 * defineState.ts
 *
 * 状態オブジェクトに型付けを提供するためのユーティリティ。
 * defineState() はアイデンティティ関数で、ThisType<> を付与することで
 * メソッド・computed getter 内の this に型補完を提供する。
 *
 * テンプレートリテラル型によるドットパスの型解決:
 * - WcsPaths<T>      : T から生成される全ドットパスの union
 * - WcsPathValue<T,P>: パス P に対応する値の型
 * - WcsPathAccessor<T>: ブラケットアクセス用マップ型
 */
/**
 * `any` 型を検出する。
 * `0 extends (1 & T)` は T が `any` の場合のみ true になる。
 */
type IsAny<T> = 0 extends (1 & T) ? true : false;
/**
 * T がドットパス再帰の対象となる「プレーンなデータオブジェクト」かどうかを判定する。
 * プリミティブ、組み込みオブジェクト (Date, Map 等)、関数、配列、any は除外。
 */
type IsPlainObject<T> = IsAny<T> extends true ? false : T extends string | number | boolean | null | undefined | symbol | bigint | ((...args: any[]) => any) | Date | RegExp | Error | Map<any, any> | Set<any> | WeakMap<any, any> | WeakSet<any> | Promise<any> | readonly any[] ? false : T extends Record<string, any> ? true : false;
/**
 * T のキーのうち、関数でないもの（データプロパティ・computed getter）を抽出する。
 * メソッド（イベントハンドラ等）はドットパスの対象外。
 * `$` プレフィックスキー（$streams / $commandTokens / $on 等の予約宣言）もドットパスにならない。
 * any 型のプロパティは除外せず保持する。
 */
type DataKeys<T> = {
    [K in keyof T & string]: K extends `$${string}` ? never : IsAny<T[K]> extends true ? K : T[K] extends (...args: any[]) => any ? never : K;
}[keyof T & string];
/**
 * 型 T から生成される全てのドットパスの union。
 * 配列プロパティはワイルドカード `*` を使用: `items.*.name`
 *
 * 再帰の深さは最大4レベルに制限（コンパイル性能の確保）。
 *
 * @example
 * ```ts
 * type S = {
 *   count: number;
 *   users: { name: string; age: number }[];
 *   cart: { items: { price: number }[] };
 * };
 * type P = WcsPaths<S>;
 * // = "count" | "users" | "users.*" | "users.*.name" | "users.*.age"
 * //   | "cart" | "cart.items" | "cart.items.*" | "cart.items.*.price"
 * ```
 */
type WcsPaths<T, Depth extends readonly any[] = []> = Depth["length"] extends 4 ? never : {
    [K in DataKeys<T>]: K | (T[K] extends readonly (infer E)[] ? IsPlainObject<E> extends true ? `${K}.*` | WcsSubPaths<E, `${K}.*.`, [...Depth, 0]> : `${K}.*` : IsPlainObject<T[K]> extends true ? WcsSubPaths<T[K], `${K}.`, [...Depth, 0]> : never);
}[DataKeys<T>];
/** @internal プレフィックス付きサブパスの生成ヘルパー */
type WcsSubPaths<T, Prefix extends string, Depth extends readonly any[]> = WcsPaths<T, Depth> extends infer P extends string ? `${Prefix}${P}` : never;
/**
 * ドットパス P に対応する値の型を T から解決する。
 *
 * 解決順序:
 * 1. T の直接キー（computed getter 含む）
 * 2. `K.*` → 配列要素型
 * 3. `K.rest` → オブジェクト/配列のネストを再帰的に辿る
 *
 * @example
 * ```ts
 * type S = { cart: { items: { price: number; qty: number }[] } };
 * type V1 = WcsPathValue<S, "cart.items.*.price">; // number
 * type V2 = WcsPathValue<S, "cart.items.*">;        // { price: number; qty: number }
 * type V3 = WcsPathValue<S, "cart">;                 // { items: ... }
 * ```
 */
type WcsPathValue<T, P extends string> = P extends keyof T ? T[P] : P extends `${infer K}.*` ? K extends keyof T ? T[K] extends readonly (infer E)[] ? E : never : never : P extends `${infer K}.${infer Rest}` ? K extends keyof T ? T[K] extends readonly (infer E)[] ? Rest extends `*.${infer SubRest}` ? WcsPathValue<E, SubRest> : Rest extends "*" ? E : never : T[K] extends Record<string, any> ? WcsPathValue<T[K], Rest> : never : never : never;
/**
 * 全ドットパスに対する型付きブラケットアクセスを提供するマップ型。
 *
 * `this["users.*.name"]` のようなアクセスに対して、
 * WcsPaths で生成されたパスに対応する値の型を返す。
 */
type WcsPathAccessor<T> = {
    [P in WcsPaths<T>]: WcsPathValue<T, P>;
};
/**
 * `<wcs-state>` の Proxy 経由で提供されるAPIメソッド。
 * state定義オブジェクト内のメソッド・getter で `this.` 経由で利用可能。
 */
interface WcsStateApi {
    /**
     * ワイルドカードを含むパスにマッチする全要素を配列で取得する。
     *
     * @param path - ワイルドカードを含むパス
     * @param indexes - 各ワイルドカード階層のインデックス（省略時はループコンテキストから解決）
     *
     * @example
     * ```ts
     * get "cart.totalPrice"() {
     *   return this.$getAll("cart.items.*.price").reduce((sum, v) => sum + v, 0);
     * }
     * ```
     */
    $getAll<V = any>(path: string, indexes?: number[]): V[];
    /**
     * 指定パスの更新を手動でトリガーする。
     * Proxy の set トラップを経由せずに内部状態を変更した場合に使用。
     */
    $postUpdate(path: string): void;
    /**
     * パスとインデックス配列を指定して、ワイルドカードを解決した値を取得・設定する。
     *
     * @param path - ワイルドカードを含むパス
     * @param indexes - 各ワイルドカード階層のインデックス
     * @param value - 設定する値（省略時は取得）
     */
    $resolve(path: string, indexes: number[], value?: any): any;
    /**
     * 指定パスへの依存関係を明示的に登録する。
     * computed getter 内で動的にパスを組み立てる場合に使用。
     */
    $trackDependency(path: string): void;
    /** `<wcs-state>` 要素への参照 */
    readonly $stateElement: HTMLElement;
    /**
     * `$commandTokens` で宣言した command token の名前空間。
     * `this.$command.<name>` で token を解決できる（バインディングでは
     * `onclick: $command.<name>` / `command.<method>: $command.<name>`）。
     */
    readonly $command: Record<string, {
        emit(...args: any[]): any;
    }>;
    /** `$streams` 各エントリの状態（"idle" | "active" | "done" | "error"）を返す読み取り専用名前空間 */
    readonly $streamStatus: Record<string, "idle" | "active" | "done" | "error">;
    /** `$streams` 各エントリの直近エラーを返す読み取り専用名前空間 */
    readonly $streamError: Record<string, unknown>;
    readonly [key: `$streamStatus.${string}`]: "idle" | "active" | "done" | "error";
    readonly [key: `$streamError.${string}`]: unknown;
    readonly $1: number;
    readonly $2: number;
    readonly $3: number;
    readonly $4: number;
    readonly $5: number;
    readonly $6: number;
    readonly $7: number;
    readonly $8: number;
    readonly $9: number;
}
/**
 * state定義オブジェクト内の `this` の型。
 *
 * - `T` のプロパティに型付きでアクセス可能（直接キー）
 * - `WcsPathAccessor<T>` によるネストされたドットパスの型付きアクセス
 * - `WcsStateApi` のメソッド ($getAll, $postUpdate 等) にアクセス可能
 * - 動的パス (`this[\`items.${i}.name\`]`) は型チェック対象外（キャストが必要）
 *
 * @example
 * ```ts
 * defineState({
 *   count: 0,
 *   users: [] as { name: string; age: number }[],
 *   increment() {
 *     this.count++;                // number
 *     this["users.*.name"];        // string (パス型解決)
 *     this.$getAll("users.*.age"); // API
 *   }
 * });
 * ```
 */
type WcsThis<T> = T & WcsStateApi & WcsPathAccessor<T>;
/**
 * `<wcs-state>` 用の型付き状態オブジェクトを定義する。
 *
 * ランタイムではアイデンティティ関数（引数をそのまま返す）として動作し、
 * コストはゼロ。TypeScript の `ThisType<>` を利用して、メソッド・getter 内の
 * `this` に型補完を提供する。
 *
 * ### 基本的な使い方 (TypeScript)
 * ```ts
 * import { defineState } from '@wcstack/state';
 *
 * export default defineState({
 *   count: 0,
 *   users: [] as { name: string; age: number }[],
 *
 *   increment() {
 *     this.count++;            // ✅ number
 *     this["users.*.name"];    // ✅ string (ドットパス型解決)
 *   },
 *
 *   get "users.*.ageCategory"() {
 *     return this["users.*.age"] < 25 ? "Young" : "Adult";
 *   }
 * });
 * ```
 *
 * ### JavaScript (JSDoc)
 * ```js
 * import { defineState } from '@wcstack/state';
 *
 * export default defineState({
 *   count: 0,
 *   increment() {
 *     this.count++;  // ✅ JSDoc + tsconfig checkJs で型補完
 *   }
 * });
 * ```
 *
 * ### HTML インラインスクリプト
 * ```html
 * <wcs-state>
 *   <script type="module">
 *     import { defineState } from '@wcstack/state';
 *     export default defineState({
 *       count: 0,
 *       increment() { this.count++; }
 *     });
 *   </script>
 * </wcs-state>
 * ```
 *
 * ### ライフサイクルコールバック
 * ```ts
 * export default defineState({
 *   data: null,
 *   async $connectedCallback() {
 *     this.data = await fetch('/api/data').then(r => r.json());
 *   },
 *   $disconnectedCallback() {
 *     // cleanup
 *   },
 *   $updatedCallback() {
 *     // called after DOM update
 *   }
 * });
 * ```
 */
declare function defineState<T extends Record<string, any>>(definition: T & ThisType<WcsThis<T>>): T;

declare const VERSION: string;

/**
 * filterMeta.ts — 組み込みフィルタの構造化メタデータ（単一正本・route-a A2-1）。
 *
 * これまで vscode-wcs（completionData.ts BUILTIN_FILTERS）が手で持っていたフィルタの
 * 引数仕様・型・説明を、実装側（@wcstack/state）に**正本として移設**したもの。
 * manifest.ts がこれを公開し、vscode-wcs はそれを消費して手リストを撤去できる。
 *
 * 完全性は __tests__/manifest.test.ts のドリフト検出が保証する
 * （filterMeta のキー集合 == builtinFilters のキー集合）。フィルタを追加して meta を
 * 書き忘れると CI が落ちる。
 */
type FilterResultType = "boolean" | "number" | "string" | "passthrough";
type FilterArgType = "number" | "string" | "any";
interface IFilterMeta {
    /** 説明（補完・ホバー用） */
    description: string;
    /** 引数を取るか */
    hasArgs: boolean;
    /** 適用後の結果型（passthrough は入力型をそのまま返す） */
    resultType: FilterResultType;
    /** 受け入れ可能な入力型（'any' は任意） */
    acceptTypes: "any" | readonly string[];
    /** 引数の最小数 */
    minArgs: number;
    /** 引数の最大数 */
    maxArgs: number;
    /** 各引数の期待型（省略時はチェックしない） */
    argTypes?: readonly FilterArgType[];
}
/** 組み込みフィルタ名 → 構造化メタデータ。キー集合は builtinFilters と一致しなければならない。 */
declare const builtinFilterMeta: Record<string, IFilterMeta>;

/** マニフェストのバージョン（構造を変えたら上げる）。 */
declare const WCS_MANIFEST_VERSION = 1;
interface IWcsManifest {
    version: number;
    syntax: {
        /** バインド属性名（既定 data-wcs） */
        bindAttribute: string;
        /** タグ名（既定 wcs-state） */
        tagName: string;
        /** パス区切り（`.`） */
        pathDelimiter: string;
        /** ワイルドカード（`*`） */
        wildcard: string;
        /** バインディング構文 `[prop][#mod]: [path][@state][|filter...]` の区切り文字 */
        delimiters: {
            binding: string;
            propValue: string;
            modifier: string;
            stateName: string;
            filter: string;
        };
        /** 構造ディレクティブ（`<template data-wcs="for: ...">` 等） */
        structuralDirectives: readonly string[];
    };
    /** 組み込みフィルタ名（builtinFilters から自動導出＝実装が正本） */
    filters: string[];
    /** 組み込みフィルタの構造化メタデータ（説明・引数仕様・型）。vscode-wcs の手リスト撤去用。 */
    filterMeta: Record<string, IFilterMeta>;
    /** 予約ライフサイクルフック名 */
    reservedLifecycle: readonly string[];
    /** 予約 state API（プロトコル系の `$` 名前空間） */
    reservedStateApi: readonly string[];
}
/** 機械可読な単一正本を返す。vscode-wcs はこれを消費する想定。 */
declare function getWcsManifest(): IWcsManifest;

/**
 * devtools/types.ts
 *
 * DevTools Hook Protocol (docs/devtools-hook-protocol.md) の型定義。
 *
 * イベント payload はランタイム内部オブジェクト（IAbsoluteStateAddress /
 * IBindingInfo 等）への生参照を含む（同一 realm・オーバーレイ前提、protocol 原則 4）。
 * 消費者はこれらを変異してはならない。
 */

type DevtoolsEvent = {
    readonly type: "state:element-registered";
    readonly name: string;
    readonly rootNode: Node;
    readonly element: IStateElement;
} | {
    readonly type: "state:element-unregistered";
    readonly name: string;
    readonly rootNode: Node;
    readonly element: IStateElement;
} | {
    readonly type: "state:write";
    readonly absoluteAddress: IAbsoluteStateAddress;
    readonly value: unknown;
    /** same-value guard が既に取得していた場合のみ意味を持つ（protocol §4.2） */
    readonly oldValue: unknown;
    readonly hasOldValue: boolean;
} | {
    readonly type: "state:update-batch";
    readonly addresses: ReadonlySet<IAbsoluteStateAddress>;
} | {
    readonly type: "state:binding-added";
    readonly absoluteAddress: IAbsoluteStateAddress;
    readonly binding: IBindingInfo;
} | {
    readonly type: "state:binding-removed";
    readonly absoluteAddress: IAbsoluteStateAddress;
    readonly binding: IBindingInfo;
} | {
    readonly type: "state:binding-cleared";
    readonly absoluteAddress: IAbsoluteStateAddress;
} | {
    readonly type: "state:token-emit";
    readonly kind: "command" | "event";
    readonly stateName: string | null;
    readonly tokenName: string;
    readonly args: readonly unknown[];
    readonly subscriberCount: number;
} | {
    readonly type: "propagation:suppressed";
    readonly reason: "confirmation" | "visited-edge";
    readonly transactionId: number;
    readonly edgeId: number;
    readonly node: Node;
    readonly member: string;
} | {
    readonly type: "propagation:coalesced";
    readonly absoluteAddress: IAbsoluteStateAddress;
    readonly droppedTransactionId: number;
    readonly winnerTransactionId: number;
} | {
    readonly type: "propagation:hop-limit";
    readonly absoluteAddress: IAbsoluteStateAddress;
    readonly transactionId: number;
    readonly hop: number;
} | {
    readonly type: "contract:manifest-read";
    readonly tag: string;
    /** 実行時に該当タグが登録済みか(未登録なら drift の起点)。 */
    readonly loaded: boolean;
} | {
    readonly type: "contract:unsupported-extension";
    readonly namespace: string;
} | {
    readonly type: "contract:drift";
    readonly reason: "component-not-loaded" | "missing-member" | "event-mismatch";
    readonly tag: string;
    readonly member?: string;
    /** event-mismatch のとき: sidecar 宣言 event / live event。 */
    readonly sidecarEvent?: string;
    readonly liveEvent?: string;
};
/** contract analyzer(Phase 5b)が生成しうる event だけの狭い union(公開 API の戻り型)。 */
type ContractEvent = Extract<DevtoolsEvent, {
    readonly type: "contract:manifest-read" | "contract:unsupported-extension" | "contract:drift";
}>;

/**
 * contract/types.ts
 *
 * Phase 5b(dev-time contract analyzer)が読む sidecar manifest の最小 subset。
 * 完全な JSON-Schema subset 検証は CI 側(vscode-wcs の validator core)の責務であり、
 * runtime analyzer は「実際に読み込まれた wcBindable 宣言との drift」照合に絞る。
 *
 * この型は vscode-wcs の `wcstack.types` を copy-distribution したもの(§14: ランタイム
 * 依存を導入しない)。CI 側の全量型ではなく drift 照合に必要な形だけを持つ。
 */
interface IContractObservable {
    readonly event?: string;
}
interface IContractComponent {
    readonly observables?: Readonly<Record<string, IContractObservable>>;
    readonly inputs?: Readonly<Record<string, unknown>>;
    readonly commands?: Readonly<Record<string, unknown>>;
}
interface IContractManifest {
    readonly manifestExtensions?: {
        readonly "wcstack.types"?: {
            readonly components?: Readonly<Record<string, IContractComponent>>;
        };
        readonly [namespace: string]: unknown;
    };
}

/**
 * contract/contractAnalyzer.ts
 *
 * Phase 5b(09-remediation-design.md §5b / §7.1 dev runtime / §6 contract trace)の
 * opt-in dev-time analyzer。実際に登録済みの custom element の `static wcBindable`
 * 宣言(= 実行時の正本)を、利用者が渡した sidecar manifest と突き合わせ、drift を
 * DevTools trace(`contract:*`)へ流す。
 *
 * 完了条件「無効時の runtime 挙動・cost が不変」: `analyzeContract` は
 * `config.enableContractAnalyzer` が false のとき即 return し、manifest を一切走査
 * しない(hot path には一切フックしない — 純粋な on-demand API)。
 *
 * pure な core(`analyzeManifestContract`)は宣言解決と emit を注入で受けるためテスト可能。
 */

/**
 * opt-in dev-time contract analysis。無効時はゼロコスト(即 return・manifest 非走査)。
 * 有効時は live 宣言と manifest を突き合わせ、`contract:*` trace を返しつつ、DevTools
 * sink が接続されていれば同時に流す。
 */
declare function analyzeContract(manifest: IContractManifest): readonly ContractEvent[];

export { Ssr, VERSION, WCS_MANIFEST_VERSION, analyzeContract, bootstrapState, buildBindings, builtinFilterMeta, defineState, getBindingsReady, getConfig, getWcsManifest };
export type { ContractEvent, FilterArgType, FilterResultType, IContractManifest, IFilterMeta, ISsrElement, IWcsManifest, IWritableConfig, IWritableTagNames, WcsPathValue, WcsPaths, WcsStateApi, WcsThis };

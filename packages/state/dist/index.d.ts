/**
 * list/listKeys.ts
 *
 * `$listKeys: { <listPath>: <fieldName | (row) => key> }` 宣言マップを解析し、
 * 「リストパス → キー指定」表を構築する（docs/state-list-key-design.md §3）。
 *
 * この表が存在するリストパスへの配列代入は、setByAddress でキー突合され、
 * 一致行は旧オブジェクトを据え置いたまま変化フィールドだけが per-path 書き込みで
 * 流し込まれる（§2）。未宣言なら書き込み経路は従来と完全に同一。
 *
 * 「そのパスが実際にリストか」は宣言時には判定できない（listPaths は
 * バインディング収集時に確定する）。実行時に配列でなければ経路に入らないだけで、
 * 宣言自体はエラーにしない。
 */

/** キー指定: フラットなフィールド名、または行から複合キーを作る関数 */
type ListKeySpec = string | ((row: any) => unknown);
type ListKeyMap = ReadonlyMap<string, ListKeySpec>;

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

/**
 * pathDiagnostics.ts — バインド / `$watch` 対象パスの存在検査（silent failure の可視化）。
 *
 * なぜ必要か:
 * `getByAddress` は「親が null / undefined のパスの読み」を undefined で返し、
 * undefined はプロパティ書き込みがスキップされる値なので、`user.nmae` のような
 * 打ち間違いは**エラーも警告も出さずに DOM が更新されない**だけになる。一方で
 * トップレベルの打ち間違い（`cout`）は parentAddress を辿れず raiseError で落ちる。
 * 同じ「パスを打ち間違えた」という 1 つの失敗が、パスの深さで silent / loud に
 * 割れており、書き手からは区別がつかない。ここはその silent 側を埋める。
 *
 * 精度方針（過小近似）:
 * 「確実に存在しない」と言い切れる場合にだけ報告する。getter の戻り値の先・
 * 空配列・null 親・mapped な `bind-component` など、静的に決められない形はすべて
 * `"unknown"` に倒して黙る（偽陽性ゼロ優先。docs/static-wiring-dx-design.md D7 /
 * [ADR-06](../../docs/architecture-hardening/06-path-type-safety.md) の精度哲学）。
 *
 * 診断 code はコンソール → lint → IDE の三面で共有する（errorGuidance.ts の規約）。
 */

/** `setPathInfo` の呼び出し元の種別。診断 code と適用範囲がこれで変わる */
type PathInfoSource = 
/** data-wcs / mustache / コメントバインディング */
"binding"
/** `$watch` の宣言キー */
 | "watch"
/** ランタイム内部のパス翻訳（mapped な bind-component の外向き伝播）。検査しない */
 | "internal";

declare const setLoopContextSymbol: unique symbol;
declare const getByAddressSymbol: unique symbol;
declare const hasByAddressSymbol: unique symbol;
declare const setByAddressSymbol: unique symbol;
declare const connectedCallbackSymbol: unique symbol;
declare const disconnectedCallbackSymbol: unique symbol;
declare const updatedCallbackSymbol: unique symbol;

interface IStateProxy extends IState {
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
    /**
     * state のロードが完了しているか。`initializePromise` の同期版で、
     * DCC のアクセサが「今すぐ読み書きしてよいか」を判断するのに使う。
     * optional なのはテスト用モック互換のため（undefined は「不明＝未初期化扱い」）。
     */
    readonly initialized?: boolean;
    /**
     * この state element が今使えるか（＝ 接続済みで rootNode を保持しているか）。
     * `createState` は rootNode を要求するので、false のときに呼ぶと raiseError する。
     * 台帳に載っていること（登録済み）と使えることは別で、要素をキーにした台帳には
     * 切断済みの state element が残る窓がある（§1.9）。
     * optional なのはテスト用モック互換のため（undefined は「不明＝使える扱い」）。
     */
    readonly hasRootNode?: boolean;
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
    /**
     * `bind-component` で束ねられているコンポーネント要素（親スコープ側のノード）。
     * マッピング規則の引き当てに使う。optional なのはテスト用モック互換のため。
     */
    readonly boundComponent?: Element | null;
    /**
     * この state の実体が innerState proxy（＝ 値の正本が親スコープの state にある
     * mapped な `bind-component`）か。真のときだけ越境アドレスの受け渡しと
     * リストパスの外向き伝播が働く（§1.8）。
     * optional なのはテスト用モック互換のため（undefined は plain 扱い）。
     */
    readonly hasMappedComponentState?: boolean;
    markComponentStateMapped?(): void;
    /**
     * DCC の `$bindables` から生成した「パス → 変更イベント名」表。
     * 唯一の書き手は defineDCC で、読み手は setByAddress。
     * getter だけを公開して setter をインターフェースから落としていたため
     * defineDCC が具象 State に依存していた（§3.5）。
     */
    readonly bindableEventMap: Record<string, string>;
    setBindableEventMap(map: Record<string, string>): void;
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
    /**
     * `$listKeys` 宣言から生成した「リストパス → キー指定」表。
     * 宣言が無ければ null / undefined で、setByAddress のキー突合経路に一切入らない
     * （docs/state-list-key-design.md §7-1 のゼロコスト契約）。
     * optional なのはテスト用モック互換のため（undefined は「宣言なし」扱い）。
     */
    readonly listKeys?: ListKeyMap | null;
    /**
     * `$watch` 宣言から生成した監視対象パスの集合。
     * 宣言が無ければ null / undefined で、setByAddress の旧値キャプチャには一切入らない
     * （docs/state-watch-hook-design.md §10 のゼロコスト契約）。
     * optional なのはテスト用モック互換のため（undefined は「宣言なし」扱い）。
     */
    readonly watchPaths?: ReadonlySet<string> | null;
    /**
     * パスを依存グラフへ登録する。DOM バインディング登録（BindingSession）のほか、
     * `$watch` 宣言（processWatchDeclaration）からも呼ばれる — 静的依存グラフに
     * 載るのがバインド済みパスだけだと headless 購読が成立しないため（設計書 §8）。
     *
     * `source` は存在検査の診断 code と適用範囲を決める（pathDiagnostics.ts）。
     * 省略時は `"binding"`（テスト用モック互換のため optional）。
     */
    setPathInfo(path: string, bindingType: BindingType, source?: PathInfoSource): void;
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
interface IBindingInfo extends IParsedBinding {
    readonly node: Node;
    readonly replaceNode: Node;
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

declare function bootstrapState(config?: IWritableConfig, registry?: CustomElementRegistry): void;

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
     * @param indexes - 各ワイルドカード階層のインデックス（前方一致の接頭辞。`[]` は全階層を展開）。
     *   省略時はループ文脈の添字（`[$1..$n]` 相当）のうち path と共有するワイルドカード連鎖の
     *   分が接頭辞として敷かれる（文脈が path より深い分は切り詰め）。共有が無いのに文脈が
     *   添字を持つ場合は throw する — 異なる文脈の添字は流用しない。
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
     * ワイルドカードを含むパスにマッチする**全アドレスへ一括で書き込む**（`$getAll` の対称形）。
     *
     * 配列を作り直さずに一括更新するための API。`this.users = this.users.map(...)` は
     * ListIndex・行 getter キャッシュ・差分描画をまとめて作り直すが、`$setAll` は
     * in-place な個別書き込みに分解するのでリストの同一性が保たれる。
     *
     * - `indexes` は `$getAll` と同じ**前方一致の接頭辞**（`[]` で全階層を展開）。省略は不可。
     * - 関数を渡すと **mapper**（`(current, ...indexes) => next`）として要素ごとに評価される。
     * - 配列は既定でブロードキャストされる。1 件ずつ配るには `{ spread: true }` を明示する。
     * - `undefined` を書こうとした要素はスキップされる（クリアは `null`）。
     *
     * @returns 実際に書き込んだ件数（`undefined` でスキップした分を含まない）
     *
     * @example
     * ```ts
     * toggleAll(e: Event) {
     *   this.$setAll("users.*.selected", [], (e.target as HTMLInputElement).checked);
     * }
     * invertAll() {
     *   this.$setAll("users.*.selected", [], cur => !cur);
     * }
     * ```
     */
    $setAll<V = any>(path: string, indexes: number[], value: V | ((current: V, ...indexes: number[]) => V | undefined)): number;
    $setAll<V = any>(path: string, indexes: number[], values: readonly V[], options: {
        spread: true;
    }): number;
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
    /**
     * コールバック実行中の依存追跡（動的依存・`$1` インデックス依存の登録）を
     * 抑止して fn を実行し、その戻り値を返す（`$trackDependency` と対称）。
     * リスト行 getter が「行外の単一値」を読みたいが、その値の変更で全行を
     * 再評価させたくない場合に使う（該当行へ直接書き込む設計と組で用いる）。
     */
    $untrackDependency<T>(fn: () => T): T;
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
        /**
         * 修飾子（`#` 後）の語彙。flags は値を取らない形（`#prevent`）、keyValue は
         * `=` で値を取る形（`#init=element`）、eventNamePrefix は `on` + イベント名の形
         * （`#onchange` — two-way / radio / checkbox のイベント名上書き。README「Modifiers」）。
         * define.ts の定数が単一正本で、ランタイムの消費箇所も同じ定数に分岐する。
         */
        modifiers: {
            flags: readonly string[];
            keyValue: readonly string[];
            eventNamePrefix: string;
        };
        /** リストインデックス参照名（`$1`..`$N`）。prefix + 1 始まり連番、maxDepth まで。 */
        indexParam: {
            prefix: string;
            maxDepth: number;
        };
        /**
         * bindingType 判別の語彙（parseBindTextsForElement の分岐と同一の定数から導出）。
         * 判別順: else → spread → 構造ディレクティブ/radio/checkbox → eventToken・`on*`
         * （event）→ prop。propNamespaces は左辺先頭セグメントの特殊 namespace で、
         * apply 層のディスパッチキー集合との一致はテストが強制する。
         * 既知の未収載: `radio` / `checkbox`（BindingType union のみが正本）。
         */
        bindingTypes: {
            elseKeyword: string;
            spread: string;
            eventPropertyPrefix: string;
            propNamespaces: {
                eventToken: string;
                command: string;
                class: string;
                attr: string;
                style: string;
            };
        };
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
    readonly type: "state:watch-error";
    /** throw 元。cur の評価（getter）とハンドラ本体では原因も直し方も違う */
    readonly phase: "prime" | "evaluate" | "handler";
    readonly stateName: string;
    /** `$watch` の宣言キー（ワイルドカードを含む生のパス） */
    readonly path: string;
    readonly error: unknown;
} | {
    readonly type: "state:watch-chain-limit";
    readonly maxDepth: number;
    /** 打ち切ったバッチに載っていたアドレスのパス（報告用） */
    readonly paths: readonly string[];
} | {
    readonly type: "state:watch-fired";
    readonly stateName: string;
    /** `$watch` の宣言キー（ワイルドカードを含む生のパス） */
    readonly path: string;
} | {
    readonly type: "state:path-unresolved";
    /** 書き手が書いた面。診断 code が binding / watch で変わる */
    readonly source: "binding" | "watch";
    readonly stateName: string;
    /** 宣言されたパス（ワイルドカードを含む生の文字列） */
    readonly path: string;
    /** 解決に失敗したセグメント */
    readonly missingSegment: string;
} | {
    readonly type: "state:binding-apply-error";
    readonly stateName: string;
    /** バインディングの state パス（ワイルドカードを含む生の文字列） */
    readonly path: string;
    readonly bindingType: string;
    readonly error: unknown;
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

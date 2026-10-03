type BindingType = 'text' | 'prop' | 'event' | 'for' | 'if' | 'elseif' | 'else' | 'radio' | 'checkbox' | 'spread';

/**
 * The public types of @wcstack/state (the same names as 3.x). The engine's own classes stay
 * internal: a page reaches `<wcs-state>` through `IStateElement`.
 */

interface IWritableTagNames {
    state?: string;
    ssr?: string;
}
/** `bootstrapState(config)`: every option is optional (README "Configuration"). */
interface IWritableConfig {
    bindAttributeName?: string;
    commentForPrefix?: string;
    commentIfPrefix?: string;
    commentElseIfPrefix?: string;
    commentElsePrefix?: string;
    tagNames?: IWritableTagNames;
    locale?: string;
    enableContractAnalyzer?: boolean;
}
/** What `$errorCallback(error, info)` receives about the binding that failed. */
interface IBindingErrorInfo {
    /** The bound state path as written in `data-wcs` (wildcards intact). */
    readonly path: string;
    /** The binding's type as the parser classifies it. */
    readonly bindingType: BindingType;
    /**
     * The node the binding is on (the Text node for a text binding); null for a list no `for:`
     * renders (one only `$getAll` or `$watch` keeps) that failed to read.
     */
    readonly node: Node | null;
}
/** `<wcs-state>` (README "IStateElement"). */
interface IStateElement extends HTMLElement {
    /** Resolves when the state is loaded and the page bound — also when initialization fails. */
    readonly initializePromise: Promise<void>;
    /**
     * Resolves once `connectedCallback` completed (`$connectedCallback` run); a root that fails to
     * initialize rejects it, and so does one whose `$connectedCallback` rejects (its page is bound), a
     * DCC definition and a component mount (`bind-component`) that fail — a volume that fails resolves it.
     */
    readonly connectedCallbackPromise: Promise<void>;
    /** Runs `callback` with a state proxy; its writes are applied in the next drain. */
    createState(mutability: "readonly" | "writable", callback: (state: Record<string, any>) => void): void;
    /** `createState` whose callback may await; a readonly proxy stays readonly across its awaits. */
    createStateAsync(mutability: "readonly" | "writable", callback: (state: Record<string, any>) => Promise<void>): Promise<void>;
    /**
     * Before initialization: the initial state. After: replaces the whole state and re-applies every
     * binding — also on a root whose `$connectedCallback` rejected. Throws on a root that failed to
     * initialize (#14), and on a loaded volume, component (`bind-component`) or DCC definition.
     */
    setInitialState(state: Record<string, any>): void;
}

/**
 * Resolves when the bindings of `root` are built — by any `<wcs-state>` in it now, whatever its
 * `$connectedCallback` does then, as 3.x — and rejects, with the first failure, only when every one
 * failed before building them. A stray one (a second root, #47; one that fails to load) changes
 * nothing while another binds the root; one taken out of the page counts no more once another
 * connects (a root replaced: the new one decides).
 */
declare function getBindingsReady(root: Node): Promise<void>;
/**
 * The base of the package's elements: HTMLElement, or — where there is none (Node without a DOM)
 * — an inert class, so the entries can be imported headless (a tool reading the manifest, a
 * server framework importing at the top level), as 3.x. Making an element stays a browser's.
 */
declare const HTMLElementBase: typeof HTMLElement;
/**
 * Waits for the bindings under `root` (3.x built them here; the new engine builds them when the
 * root's `<wcs-state>` loads its state, so this only waits — the same as getBindingsReady).
 */
declare const buildBindings: (root: Document | ShadowRoot) => Promise<void>;

interface ISsrElement {
    /** The @wcstack/state version that rendered the page. */
    readonly version: string;
    /** The state's data the server rendered with. */
    readonly stateData: Record<string, any>;
    /** The page-level templates, by id. */
    readonly templates: Map<string, HTMLTemplateElement>;
    /** Always empty: every binding is applied when the client adopts the server's DOM (3.x kept a value table here). */
    readonly hydrateProps: Record<string, Record<string, unknown>>;
    getTemplate(id: string): HTMLTemplateElement | null;
    /** The snapshot is adoptable: the same major.minor as this build. */
    verifyVersion(): boolean;
}
declare class Ssr extends HTMLElementBase implements ISsrElement {
    /** The first snapshot element under `root`, or null. */
    static find(root: Node): ISsrElement | null;
    get version(): string;
    get stateData(): Record<string, any>;
    get templates(): Map<string, HTMLTemplateElement>;
    get hydrateProps(): Record<string, Record<string, unknown>>;
    getTemplate(id: string): HTMLTemplateElement | null;
    verifyVersion(): boolean;
}

/**
 * Page-wide configuration (`bootstrapState(config)`): how this page spells wcstack markup (the tag
 * names, the binding attribute, the anchor comments — fixed before the first definition, the same
 * on the server) and the locale default. How a state tree behaves is its own `$behavior` (engine.ts).
 */
interface Config {
    bindAttributeName: string;
    /** The text of a `for` template's anchor comment. */
    commentForPrefix: string;
    /** The texts of an `if` / `elseif` / `else` chain's anchor comments. */
    commentIfPrefix: string;
    commentElseIfPrefix: string;
    commentElsePrefix: string;
    tagNames: {
        state: string;
        ssr: string;
    };
    locale: string;
    /** Opt-in `analyzeContract()` (dev time); off, it returns at once. */
    enableContractAnalyzer: boolean;
}
/** The current configuration (read-only view). */
declare const getConfig: () => Readonly<Config>;

/**
 * Trusted Types for the HTML sinks (`html:`, `innerHTML:`, `outerHTML:`, `srcdoc:`).
 * The policy lives on the same global slot as @wcstack/state, so a page that installed
 * one for the current engine keeps working:
 *   globalThis[Symbol.for("wcstack.trustedTypes.policy")] = trustedTypes.createPolicy(…)
 * No identity policy is ever created here — that would defeat the CSP.
 */
interface TrustedTypesPolicy {
    createHTML?(input: string): unknown;
}
declare const TRUSTED_TYPES_POLICY_SLOT: unique symbol;
declare function getTrustedTypesPolicy(): TrustedTypesPolicy | null;
declare function setTrustedTypesPolicy(policy: TrustedTypesPolicy | null): void;

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
    $dependOn(path: string): void;
    /**
     * コールバック実行中の依存追跡（動的依存・`$1` インデックス依存の登録）を
     * 抑止して fn を実行し、その戻り値を返す。
     * リスト行 getter が「行外の単一値」を読みたいが、その値の変更で全行を
     * 再評価させたくない場合に使う（該当行へ直接書き込む設計と組で用いる）。
     */
    $untracked<T>(fn: () => T): T;
    /**
     * 鍵付き購読: `path` の現在値が `key` に等しいかを返し、評価中のリスト行 getter を
     * その鍵で購読する。`path` への書き込みは旧値・新値の鍵の行だけを再評価する
     * （パターン依存なら全行）。`path` 自体は依存として追跡しない。
     * 例: `get "items.*.selected"() { return this.$eq("selectedId", this.$untracked(() => this["items.*.id"])); }`
     */
    $eq(path: string, key: unknown): boolean;
    /**
     * `$eq` の鍵を `keyPath`（ワイルドカードは評価中の行で解決）から依存を張らずに読む形。
     * 例: `get "items.*.selected"() { return this.$eqPath("selectedId", "items.*.id"); }`
     */
    $eqPath(path: string, keyPath: string): boolean;
    /**
     * `$eq` の鍵を評価中の行の index（`$1` 相当。`level` でワイルドカード段を選ぶ）にする形。
     * getter を index 依存には記録せず、行の移動時はリスト差分が鍵を付け替えるので、
     * 1 行削除で再評価されるのは高々 2 行。
     * 例: `get "items.*.selected"() { return this.$eqIndex("selectedIndex"); }`
     */
    $eqIndex(path: string, level?: number): boolean;
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
    /** `$stream` 各エントリの状態（"idle" | "active" | "done" | "error"）を返す読み取り専用名前空間 */
    readonly $streamStatus: Record<string, "idle" | "active" | "done" | "error">;
    /** `$stream` 各エントリの直近エラーを返す読み取り専用名前空間 */
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
    readonly [key: `${string}.**.${string}`]: any;
    readonly [key: `${string}.**`]: any;
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
 *   $renderedCallback() {
 *     // called after the bindings are applied
 *   }
 * });
 * ```
 */
declare function defineState<T extends Record<string, any>>(definition: T & ThisType<WcsThis<T>>): T;

/** The package version: stamped into `<wcs-ssr>`, compared on hydration (major.minor), shown by DevTools. */
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

/** The manifest's shape version (the same shape as 3.x). */
declare const WCS_MANIFEST_VERSION = 2;
/** Filter old names → canonical (3.2): removed in 4.0. */
declare const builtinFilterAliases: Readonly<Record<string, string>>;
interface IWcsManifest {
    version: number;
    syntax: {
        bindAttribute: string;
        tagName: string;
        pathDelimiter: string;
        wildcard: string;
        delimiters: {
            binding: string;
            propValue: string;
            modifier: string;
            filter: string;
        };
        structuralDirectives: readonly string[];
        modifiers: {
            flags: readonly string[];
            keyValue: readonly string[];
            eventNamePrefix: string;
        };
        indexParam: {
            prefix: string;
            maxDepth: number;
        };
        bindingTypes: {
            elseKeyword: string;
            spread: string;
            eventPropertyPrefix: string;
            explicitPropertyPrefix: string;
            propNamespaces: {
                eventToken: string;
                command: string;
                class: string;
                attr: string;
                style: string;
            };
        };
    };
    /** The built-in filter names: the core set, then the formats add-on's. */
    filters: string[];
    filterMeta: Record<string, IFilterMeta>;
    filterAliases: Readonly<Record<string, string>>;
    declarationAliases: Readonly<Record<string, string>>;
    apiAliases: Readonly<Record<string, string>>;
    /** Reserved lifecycle hooks. */
    reservedLifecycle: readonly string[];
    /** Reserved state keys and `$` namespaces. */
    reservedStateApi: readonly string[];
    /** A state's `$behavior` options (4.0): each key, the type of its value and its value when left out. */
    behaviorOptions: Readonly<Record<string, {
        type: "boolean";
        default: boolean;
    }>>;
    /** The add-on names `$features` and the root `<wcs-state features>` take (4.0). */
    features: readonly string[];
}
declare function getWcsManifest(): IWcsManifest;

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
type ContractEvent = {
    /** One component's contract was read from the manifest; `loaded`: its tag is registered. */
    readonly type: "contract:manifest-read";
    readonly tag: string;
    readonly loaded: boolean;
} | {
    /** A manifest namespace the runtime does not interpret. */
    readonly type: "contract:unsupported-extension";
    readonly namespace: string;
} | {
    /** The manifest and the live declaration disagree (the live one is authoritative). */
    readonly type: "contract:drift";
    readonly reason: "component-not-loaded" | "missing-member" | "event-mismatch";
    readonly tag: string;
    readonly member?: string;
    readonly sidecarEvent?: string;
    readonly liveEvent?: string;
};
declare function analyzeContract(manifest: IContractManifest): readonly ContractEvent[];

/** Installs every add-on, applies `config` and registers `<wcs-state>` (in `registry`, the global one by default). */
declare function bootstrapState(config?: IWritableConfig, registry?: CustomElementRegistry): void;

declare global {
    interface HTMLElementTagNameMap {
        "wcs-state": IStateElement;
        "wcs-ssr": Ssr;
    }
}

export { Ssr, TRUSTED_TYPES_POLICY_SLOT, VERSION, WCS_MANIFEST_VERSION, analyzeContract, bootstrapState, buildBindings, builtinFilterAliases, builtinFilterMeta, defineState, getBindingsReady, getConfig, getTrustedTypesPolicy, getWcsManifest, setTrustedTypesPolicy };
export type { ContractEvent, FilterArgType, FilterResultType, IBindingErrorInfo, IContractManifest, IFilterMeta, ISsrElement, IStateElement, IWcsManifest, TrustedTypesPolicy as IWcsTrustedTypesPolicy, IWritableConfig, IWritableTagNames, WcsPathValue, WcsPaths, WcsStateApi, WcsThis };

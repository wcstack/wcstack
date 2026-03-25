interface IWritableTagNames {
    state?: string;
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
}

declare function bootstrapState(config?: IWritableConfig): void;

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
type IsPlainObject<T> = IsAny<T> extends true ? false : T extends string | number | boolean | null | undefined | symbol | bigint | Function | Date | RegExp | Error | Map<any, any> | Set<any> | WeakMap<any, any> | WeakSet<any> | Promise<any> | readonly any[] ? false : T extends Record<string, any> ? true : false;
/**
 * T のキーのうち、関数でないもの（データプロパティ・computed getter）を抽出する。
 * メソッド（イベントハンドラ等）はドットパスの対象外。
 * any 型のプロパティは除外せず保持する。
 */
type DataKeys<T> = {
    [K in keyof T & string]: IsAny<T[K]> extends true ? K : T[K] extends Function ? never : K;
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
     * @example
     * ```ts
     * get "cart.totalPrice"() {
     *   return this.$getAll("cart.items.*.price", []).reduce((sum, v) => sum + v, 0);
     * }
     * ```
     */
    $getAll<V = any>(path: string, defaultValue?: V[]): V[];
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
 *     this.$getAll("path", []);    // API
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

export { bootstrapState, defineState };
export type { IWritableConfig, IWritableTagNames, WcsPathValue, WcsPaths, WcsStateApi, WcsThis };

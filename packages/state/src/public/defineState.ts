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

// ============================================================
// Internal helper types
// ============================================================

/**
 * `any` 型を検出する。
 * `0 extends (1 & T)` は T が `any` の場合のみ true になる。
 */
type IsAny<T> = 0 extends (1 & T) ? true : false;

/**
 * T がドットパス再帰の対象となる「プレーンなデータオブジェクト」かどうかを判定する。
 * プリミティブ、組み込みオブジェクト (Date, Map 等)、関数、配列、any は除外。
 */
type IsPlainObject<T> =
  IsAny<T> extends true ? false :
  T extends
    | string | number | boolean | null | undefined | symbol | bigint
    | ((...args: any[]) => any) | Date | RegExp | Error
    | Map<any, any> | Set<any> | WeakMap<any, any> | WeakSet<any>
    | Promise<any> | readonly any[]
    ? false
    : T extends Record<string, any>
      ? true
      : false;

/**
 * T のキーのうち、関数でないもの（データプロパティ・computed getter）を抽出する。
 * メソッド（イベントハンドラ等）はドットパスの対象外。
 * `$` プレフィックスキー（$streams / $commandTokens / $on 等の予約宣言）もドットパスにならない。
 * any 型のプロパティは除外せず保持する。
 */
type DataKeys<T> = {
  [K in keyof T & string]:
    K extends `$${string}` ? never :
    IsAny<T[K]> extends true ? K : T[K] extends (...args: any[]) => any ? never : K;
}[keyof T & string];

// ============================================================
// WcsPaths — ドットパスの union 生成
// ============================================================

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
export type WcsPaths<T, Depth extends readonly any[] = []> =
  Depth["length"] extends 4 ? never :
  {
    [K in DataKeys<T>]:
      | K
      | (T[K] extends readonly (infer E)[]
          ? IsPlainObject<E> extends true
            ? `${K}.*` | WcsSubPaths<E, `${K}.*.`, [...Depth, 0]>
            : `${K}.*`
          : IsPlainObject<T[K]> extends true
            ? WcsSubPaths<T[K], `${K}.`, [...Depth, 0]>
            : never)
  }[DataKeys<T>];

/** @internal プレフィックス付きサブパスの生成ヘルパー */
type WcsSubPaths<T, Prefix extends string, Depth extends readonly any[]> =
  WcsPaths<T, Depth> extends infer P extends string
    ? `${Prefix}${P}`
    : never;

// ============================================================
// WcsPathValue — パスから値の型を解決
// ============================================================

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
export type WcsPathValue<T, P extends string> =
  // 1. Direct key (includes computed getters like "users.*.ageCategory")
  P extends keyof T
    ? T[P]
  // 2. K.* → array element type
  : P extends `${infer K}.*`
    ? K extends keyof T
      ? T[K] extends readonly (infer E)[] ? E : never
      : never
  // 3. K.rest → recurse into nested structure
  : P extends `${infer K}.${infer Rest}`
    ? K extends keyof T
      ? T[K] extends readonly (infer E)[]
        // Array: expect *.subpath or *
        ? Rest extends `*.${infer SubRest}`
          ? WcsPathValue<E, SubRest>
          : Rest extends "*"
            ? E
            : never
        // Object: recurse
        : T[K] extends Record<string, any>
          ? WcsPathValue<T[K], Rest>
          : never
      : never
    : never;

// ============================================================
// WcsPathAccessor — ブラケットアクセス用マップ型
// ============================================================

/**
 * 全ドットパスに対する型付きブラケットアクセスを提供するマップ型。
 *
 * `this["users.*.name"]` のようなアクセスに対して、
 * WcsPaths で生成されたパスに対応する値の型を返す。
 */
type WcsPathAccessor<T> = {
  [P in WcsPaths<T>]: WcsPathValue<T, P>;
};

// ============================================================
// State Proxy API — this 経由でアクセスできるAPI
// ============================================================

/** `$stream` の 1 エントリの状態。 */
type WcsStreamStatus = "idle" | "active" | "done" | "error";

/**
 * `<wcs-state>` の Proxy 経由で提供されるAPIメソッド。
 * state定義オブジェクト内のメソッド・getter で `this.` 経由で利用可能。
 * `N` は `$commandTokens` の名前、`SN` は `$stream` の名前（4.33。推論できなければどちらも `string`）。
 */
export type WcsStateApi<N extends string = string, SN extends string = string> = WcsStateApiMembers<N, SN> & WcsStreamPaths<SN>;

/**
 * @internal `$stream` の状態の dotted パス（`this["$streamStatus.<name>"]` — computed getter 内での依存追跡付き読み取りの
 * 正規形、docs/state-streams-design.md §4-3）。`SN` が `string` なら `$streamStatus.${string}` の索引になる。
 */
type WcsStreamPaths<SN extends string> =
  & { readonly [K in SN as `$streamStatus.${K}`]: WcsStreamStatus }
  & { readonly [K in SN as `$streamError.${K}`]: unknown };

/** @internal {@link WcsStateApi} のメンバー（dotted パスの索引は型引数から作るので {@link WcsStreamPaths} に分けた）。 */
interface WcsStateApiMembers<N extends string, SN extends string> {
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
   *   mapper は書き込む行の文脈で走る（4.16）: その中の `this.$1` や `this["users.*.name"]` は呼び手の行
   *   ではなく、その行を指す（アロー関数でも）。
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
  $setAll<V = any>(
    path: string,
    indexes: number[],
    value: V | ((current: V, ...indexes: number[]) => V | undefined),
  ): number;
  $setAll<V = any>(
    path: string,
    indexes: number[],
    values: readonly V[],
    options: { spread: true },
  ): number;

  /**
   * 1 つのアドレスを、今の値から書き換える（4.16）。`$resolve(path, indexes)` と同じアドレスを読み、
   * `fn(current, ...indexes)` の戻り値を書く。
   *
   * - `indexes` は `$resolve` と同じく `*` 1 本につき 1 つ（本数が違えば throw）。リストの末尾より先の
   *   添字は `fn` を呼ぶ前に `no row` で throw する。
   * - `fn` はその行の文脈で走る: その中の `this.$1` や `this["items.*.id"]` は呼び手の行ではなく、
   *   書き換える行を指す（アロー関数でも）。
   * - `fn` が `undefined` を返すと何も書かない。関数でない値を渡すと、その値を書く。
   * - パスの文字列を組み立てる `` this[`items.${i}.label`] += "!" `` と違い、パスを解析しない。
   *
   * @example
   * ```ts
   * onUpdate() {
   *   for (let i = 0; i < this.items.length; i += 10) this.$update("items.*.label", [i], (v) => v + " !!!");
   * }
   * ```
   */
  $update<V = any>(
    path: string,
    indexes: number[],
    fn: V | ((current: V, ...indexes: number[]) => V | undefined),
  ): void;

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
   * `N` は `defineState` が `$commandTokens` から推論した名前（4.26）: 宣言していない名前は型エラーになり、
   * `noUncheckedIndexedAccess` でも `undefined` を含まない。推論できなければ `string`。
   */
  readonly $command: Record<N, { emit(...args: any[]): any }>;

  /**
   * `$stream` 各エントリの状態（"idle" | "active" | "done" | "error"）を返す読み取り専用名前空間。
   * `SN` は `defineState` が `$stream` から推論した名前（4.33）: 宣言していない名前は型エラーになる。
   */
  readonly $streamStatus: Record<SN, WcsStreamStatus>;

  /** `$stream` 各エントリの直近エラーを返す読み取り専用名前空間（名前は `$streamStatus` と同じ） */
  readonly $streamError: Record<SN, unknown>;

  // ループインデックス変数 ($1〜$9)
  // for テンプレート内のイベントハンドラで、ネストされたループの
  // 各階層のインデックスにアクセスするために使用。
  // （ランタイムは $1〜$128 まで解決するが、型宣言は実用域の $9 までとする）
  readonly $1: number;
  readonly $2: number;
  readonly $3: number;
  readonly $4: number;
  readonly $5: number;
  readonly $6: number;
  readonly $7: number;
  readonly $8: number;
  readonly $9: number;

  // `$recursion` 宣言済みの再帰パス（`this["nodes.**.total"]`）。深さの族なので
  // `WcsPaths<T>` の有限展開には現れず、getter のキーに書いた 1 本しか T に現れない。
  // パターン索引で「`**` を含むキーは読める」とだけ言う（型は any — 深さを型で表せない
  // 以上、値の型も辿れない）。パターンは `**` を必ず含むので、通常のドットパスの型付けは
  // 損なわない。VS Code 拡張の preamble（vscode-wcs src/language/preamble.ts）と同じ形 —
  // 公開型面とエディタの型面は対で保つ。
  // 素の `nodes.**`（再帰 getter の中でノード自身に束縛される読み）は `.**.` を含まないので、
  // 末尾が `.**` のキーにも同じ索引を置く。
  readonly [key: `${string}.**.${string}`]: any;
  readonly [key: `${string}.**`]: any;

  // 行からの相対パス（`this[".name"]`・`this["."]`、4.22）。HTML の `for:` の中の `.name` と同じ展開で、
  // 基準は評価している行のリスト — getter / setter のキー（`get "users.*.fullname"()`）か、メソッドを
  // 呼んだ行で決まる。`this` の型は状態全体で 1 つなので、どの行かは型では表せない（型は any。
  // パスが在るかは lint が、アクセサのキーから展開して検査する）。setter は書くので readonly ではない。
  [key: `.${string}`]: any;
}

// ============================================================
// WcsThis — state メソッド/getter 内の this の型
// ============================================================

/**
 * state定義オブジェクト内の `this` の型。
 *
 * - `T` のプロパティに型付きでアクセス可能（直接キー）
 * - `WcsPathAccessor<T>` によるネストされたドットパスの型付きアクセス
 * - `WcsStateApi` のメソッド ($getAll, $postUpdate 等) にアクセス可能
 * - `WcsListedAccessors<T>` によるカンマ列挙のアクセサ（`"a.*.x,b.*.x"`）の各パス
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
/** @internal `"a.*.x,b.*.x"` → `"a.*.x" | "b.*.x"` */
type WcsListedPaths<K extends string> = K extends `${infer Head},${infer Rest}` ? Head | WcsListedPaths<Rest> : K;

/**
 * 1 つのアクセサを複数のパスに宣言したキー（`get "users.*.fullname,employees.*.fullname"()`、4.22）の
 * 各パス。どれもそのアクセサの型を持つ。
 */
type WcsListedAccessors<T> = {
  [K in keyof T & `${string},${string}` as WcsListedPaths<K>]: T[K];
};

/**
 * @internal `$stream` の名前（宣言が無ければ `string` — 今までどおり）。`$on` / `args` の state は引数から部分的に推論した
 * 写しで、その `$stream` は any（{@link WcsOnValue}）: any からは名前を取らない。
 */
type WcsStreamNames<T> = T extends { $stream: infer D } ? (IsAny<D> extends true ? string : keyof D & string) : string;

/**
 * @internal `$stream` の値（4.33）: ランタイムが宣言キーの名前で実体化するプロパティ。T には宣言オブジェクトの中にしか
 * 現れないので、getter やメソッドの this から読めるよう any で写す。initial の型は使わない — 空配列の initial が
 * never[] になり、正しい読み（要素のプロパティ）まで型エラーになるため。T に同名のプロパティを事前宣言していれば
 * 写さない（交差でその型まで any に潰さないため）。`$stream` が any（`$on` / `args` の state）なら写さない — 写すと
 * どの名前も any の索引になり、state の typo が型エラーにならない。VS Code 拡張の preamble の _WcsDeclaredValues と対。
 */
type WcsDeclaredValues<T> = T extends { $stream: infer D }
  ? (IsAny<D> extends true ? unknown : { [K in Exclude<keyof D & string, keyof T>]: any })
  : unknown;

export type WcsThis<T, N extends string = string> = T & WcsStateApi<N, WcsStreamNames<T>> & WcsPathAccessor<T> & WcsDeclaredValues<T> & WcsListedAccessors<T>;

// ============================================================
// $on — event token のハンドラ
// ============================================================

/**
 * @internal `$on` のハンドラが受け取る state。ランタイムは `handler(state, event, ...listIndexes)` と呼ぶ
 * （src/token.ts・engine.ts の deliverFn。`this` は undefined）。
 *
 * 型は `T` ではなく `S`（引数から推論した `T` の写し）から作る: ハンドラの引数の型が `T` を参照すると、
 * TypeScript は注釈の無いハンドラの引数に型を与える時点で `T` を確定させ — まだ推論の候補が無いので
 * 制約の `Record<string, any>` に — state 全体の型付け（メソッドの `this` も）が消える。`S` はマップ型
 * `{ [K in keyof S]: S[K] }` から推論されるので、関数を含む引数からも部分的に推論できる（データの型は
 * そのまま、関数は `unknown`）。ここではその `unknown` を `any` に読む — メソッドは呼べるが引数は検査されない。
 * `T` はハンドラと関わらずに推論されるので、`this` と戻り値の型は損なわない。
 */
type WcsOnState<S, N extends string> = WcsThis<{ [K in keyof S]: WcsOnValue<S[K]> }, N>;

/**
 * @internal `S` の 1 つの値の型。関数（部分的な推論で `unknown`）は `any`。`null` / `undefined` で初期化した値は、
 * strictNullChecks が無ければ `any`（`T` がそう広げるのと同じ。部分的な推論は広げないので、広げないと
 * `state.x = "…"` だけが偽のエラーになる）。`null extends string` は strictNullChecks が無いときだけ真。
 */
type WcsOnValue<V> = unknown extends V ? any : [V] extends [null | undefined] ? (null extends string ? any : V) : V;

/**
 * @internal `$on` の 1 エントリ。`this: void`（ランタイムの `this` は undefined。`this` を使うハンドラは
 * 型エラーになる — diagnostics の `[wcs/on-handler-this]` と同じ場所）。`event` は要素が発火したイベント:
 * wc-bindable の既定の getter が `detail` を読むとおり `CustomEvent`（`detail` は any）。メソッドの形（双変）
 * なので、`(state, e: CustomEvent<Detail>) => …` や `(state, e: Event) => …` のような注釈も通る。
 */
type WcsOnHandler<S> = {
  bivarianceHack(this: void, state: S, event: CustomEvent, ...indexes: number[]): unknown;
}["bivarianceHack"];

/**
 * @internal `$stream` の 1 エントリ（4.33）。関数の引数に文脈の型を与える（noImplicitAny 下の偽エラーを避ける）: `args` の
 * state は `$on` と同じ形、`signal` は AbortSignal。`source` は必須（無ければランタイムも state の初期化に失敗する）。
 */
type WcsStreamEntry<S> = {
  args?: (state: S) => unknown;
  source: (args: any, signal: AbortSignal) => unknown;
  fold?: (acc: any, chunk: any) => unknown;
  initial?: unknown;
};

/** @internal 宣言のキーのうち、`defineState` が型を与えるもの。 */
type WcsDeclarations<N extends string, S> = {
  $commandTokens?: readonly N[];
  $on?: Record<string, WcsOnHandler<WcsOnState<S, N>>>;
  $stream?: Record<string, WcsStreamEntry<WcsOnState<S, N>>>;
};

// ============================================================
// defineState — 型付き状態定義関数
// ============================================================

/**
 * `<wcs-state>` 用の型付き状態オブジェクトを定義する。
 *
 * ランタイムではアイデンティティ関数（引数をそのまま返す）として動作し、
 * コストはゼロ。TypeScript の `ThisType<>` を利用して、メソッド・getter 内の
 * `this` に型補完を提供する。
 *
 * ### 基本的な使い方 (TypeScript)
 * ```ts
 * import { defineState } from '@wcstack/state/define';
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
 * import { defineState } from '@wcstack/state/define';
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
 *     import { defineState } from '@wcstack/state/define';
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
 *
 * ### `$commandTokens` と `$on`（4.26）
 * `N` は `$commandTokens` の名前から推論する（`this.$command.<name>` を宣言した名前に絞る）。`$on` の
 * ハンドラは `(state, event, ...indexes)` に型が付く — `state` は state、`event` は `CustomEvent`、`this` は void。
 * 型引数を `<T>` だけ渡すと `N` は `string`（`$command` は今までどおり `Record<string, …>`）、`S` は `T`。
 * ```ts
 * export default defineState({
 *   count: 0,
 *   $commandTokens: ["reload"],
 *   $eventTokens: ["picked"],
 *   $on: {
 *     picked(state, event) { state.count++; state.$command.reload.emit(); },
 *   },
 * });
 * ```
 */
export function defineState<T extends Record<string, any>, N extends string = string, S = T>(
  definition: T & { [K in keyof S]: S[K] } & WcsDeclarations<N, S> & ThisType<WcsThis<T, N>>
): T {
  return definition;
}

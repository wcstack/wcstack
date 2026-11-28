/**
 * preamble.ts
 *
 * HTML インラインスクリプト用の型定義プリアンブル。
 * 仮想ドキュメントの先頭に注入することで、import なしで defineState() + パス型補完を提供する。
 *
 * インラインスクリプトはブラウザが JavaScript として実行するので、仮想コードも JavaScript として検査する
 * （4.26）。プリアンブルも JavaScript で、型はすべて JSDoc（`@typedef` / `@template` / `@type`）に書く —
 * TypeScript は JSDoc の中の型を完全な型の構文で読む（条件型・マップ型・テンプレートリテラル型）。
 * 先頭の `// @ts-check` で、tsconfig の `checkJs` に関わらず検査を有効にする。末尾の `export {};` で
 * 仮想ファイルをモジュールにする（`<script type="module">` と同じ。型名がほかのファイルの大域に漏れない）。
 *
 * 複数行の JSDoc は行頭の `*` を付けずに書く — 型の式の中の行頭の `*` を読み飛ばすかは TypeScript の版で違う。
 *
 * @wcstack/state（4.0）の defineState.ts と同等の型を含む。4.0 で外れた旧名（`$trackDependency` /
 * `$untrackDependency`）と宣言（`$scan` / `$streams`）は型に持たない — 書けば型エラーになり、
 * lint（`wcs/name-alias` など）と同じ場所を指す。
 *
 * `$behavior` のキーと型、`$features` の名前は manifest（`behaviorOptions` / `features`）から作る。
 */

import { getWcsManifest } from '../service/wcsManifest.js';

const manifest = getWcsManifest();
/** `{ enableMustache?: boolean; … }`（manifest の `behaviorOptions`）。 */
const BEHAVIOR_TYPE = `{ ${Object.entries(manifest.behaviorOptions).map(([key, option]) => `${key}?: ${option.type}`).join('; ')} }`;
/** `"formats" | "diagnostics" | …`（manifest の `features`）。 */
const FEATURE_NAME_TYPE = manifest.features.map((name) => JSON.stringify(name)).join(' | ');

export const WCS_PREAMBLE = `// @ts-check
// --- @wcstack/state type preamble (auto-injected by vscode-wcs) ---
/** @template T @typedef {0 extends (1 & T) ? true : false} _IsAny */
/**
@template T
@typedef {_IsAny<T> extends true ? false :
  T extends
    | string | number | boolean | null | undefined | symbol | bigint
    | Function | Date | RegExp | Error
    | Map<any, any> | Set<any> | WeakMap<any, any> | WeakSet<any>
    | Promise<any> | readonly any[]
    ? false
    : T extends Record<string, any> ? true : false} _IsPlainObject
*/
/**
@template T
@typedef {{
  [K in keyof T & string]:
    K extends \`$\${string}\` ? never :
    _IsAny<T[K]> extends true ? K : T[K] extends Function ? never : K;
}[keyof T & string]} _DataKeys
*/
/**
@template T
@template {readonly any[]} D
@typedef {D["length"] extends 4 ? never :
  { [K in _DataKeys<T>]:
    | K
    | (T[K] extends readonly (infer E)[]
        ? _IsPlainObject<E> extends true
          ? \`\${K}.*\` | _WcsSubPaths<E, \`\${K}.*.\`, [...D, 0]>
          : \`\${K}.*\`
        : _IsPlainObject<T[K]> extends true
          ? _WcsSubPaths<T[K], \`\${K}.\`, [...D, 0]>
          : never)
  }[_DataKeys<T>]} _WcsPaths
*/
/**
@template T
@template {string} P
@template {readonly any[]} D
@typedef {_WcsPaths<T, D> extends infer R extends string ? \`\${P}\${R}\` : never} _WcsSubPaths
*/
/**
@template T
@template {string} P
@typedef {P extends keyof T ? T[P]
  : P extends \`\${infer K}.*\`
    ? K extends keyof T ? T[K] extends readonly (infer E)[] ? E : never : never
  : P extends \`\${infer K}.\${infer R}\`
    ? K extends keyof T
      ? T[K] extends readonly (infer E)[]
        ? R extends \`*.\${infer S}\` ? _WcsPathValue<E, S> : R extends "*" ? E : never
        : T[K] extends Record<string, any> ? _WcsPathValue<T[K], R> : never
      : never
    : never} _WcsPathValue
*/
/** @template T @typedef {{ [P in _WcsPaths<T, []>]: _WcsPathValue<T, P> }} _WcsPathAccessor */
/** @typedef {"idle" | "active" | "done" | "error"} _WcsStreamStatus */
// WcsStateApi の索引（@wcstack/state の defineState と対）:
// - $command: $commandTokens に書いた名前（N）の token。名前を推論できなければ Record<string, …>。
// - $streamStatus / $streamError: $stream に書いた名前（SN、4.33）。dotted の形（\`this["$streamStatus.<name>"]\`）は
//   SN から作る索引なので _WcsStreamPaths に分けた。名前を推論できなければ string。
// - \`\${string}.**.\${string}\` / \`\${string}.**\`: $recursion 宣言済みの再帰パス（\`nodes.**.total\`・素の \`nodes.**\`）。
//   深さの族なので _WcsPaths の有限展開には現れない。\`**\` を含むキーは読める（型は any）とだけ言う。
// - \`.\${string}\`: 行からの相対パス（\`this[".name"]\`・\`this["."]\`、4.22）。基準は評価している行のリストで、
//   型では表せない（型は any。パスが在るかは lint が検査する）。setter は書くので readonly ではない。
/**
@template {string} N
@template {string} SN
@typedef {{
  $getAll<V = any>(path: string, indexes?: number[]): V[];
  $setAll<V = any>(path: string, indexes: number[], value: V | ((current: V, ...indexes: number[]) => V | undefined)): number;
  $setAll<V = any>(path: string, indexes: number[], values: readonly V[], options: { spread: true }): number;
  $update<V = any>(path: string, indexes: number[], fn: V | ((current: V, ...indexes: number[]) => V | undefined)): void;
  $postUpdate(path: string): void;
  $resolve(path: string, indexes: number[], value?: any): any;
  $dependOn(path: string): void;
  $untracked<T>(fn: () => T): T;
  $eq(path: string, key: unknown): boolean;
  $eqPath(path: string, keyPath: string): boolean;
  $eqIndex(path: string, level?: number): boolean;
  readonly $stateElement: HTMLElement;
  readonly $command: Record<N, { emit(...args: any[]): any }>;
  readonly $streamStatus: Record<SN, _WcsStreamStatus>;
  readonly $streamError: Record<SN, unknown>;
  readonly $1: number; readonly $2: number; readonly $3: number;
  readonly $4: number; readonly $5: number; readonly $6: number;
  readonly $7: number; readonly $8: number; readonly $9: number;
  readonly [key: \`\${string}.**.\${string}\`]: any;
  readonly [key: \`\${string}.**\`]: any;
  [key: \`.\${string}\`]: any;
}} _WcsStateApiMembers
*/
/** @template {string} SN @typedef {{ readonly [K in SN as \`$streamStatus.\${K}\`]: _WcsStreamStatus } & { readonly [K in SN as \`$streamError.\${K}\`]: unknown }} _WcsStreamPaths */
/** @template {string} N @template {string} SN @typedef {_WcsStateApiMembers<N, SN> & _WcsStreamPaths<SN>} WcsStateApi */
// 1 つのアクセサを複数のパスに宣言したキー（\`get "users.*.fullname,employees.*.fullname"()\`、4.22）の各パス。
// T にはキーの文字列そのものしか現れないので、カンマで分けた各パスにそのアクセサの型を写す。
/** @template {string} K @typedef {K extends \`\${infer Head},\${infer Rest}\` ? Head | _WcsListedPaths<Rest> : K} _WcsListedPaths */
/** @template T @typedef {{ [K in keyof T & \`\${string},\${string}\` as _WcsListedPaths<K>]: T[K] }} _WcsListedAccessors */
// $stream の値は、ランタイムが宣言キーの名前で実体化するプロパティ。T には宣言オブジェクトの中にしか
// 現れないので、getter やメソッドの this から読めるよう any で写す。initial の型は使わない — 空配列の
// initial が never[] になり、正しい読み（要素のプロパティ）まで型エラーになるため。
// T に同名のプロパティを明示的に事前宣言していれば写さない（交差でその型まで any に潰さないため）。
// $stream が any（$on の state は引数から部分的に推論した写しで、その $stream は any）なら写さず、名前も取らない —
// 写すとどの名前も any の索引になり、state の typo が型エラーにならない。
/** @template T @typedef {(T extends { $stream: infer S } ? (_IsAny<S> extends true ? {} : { [K in Exclude<keyof S & string, keyof T>]: any }) : {})} _WcsDeclaredValues */
/** @template T @typedef {(T extends { $stream: infer S } ? (_IsAny<S> extends true ? string : keyof S & string) : string)} _WcsStreamNames */
/** @template T @template {string} N @typedef {T & WcsStateApi<N, _WcsStreamNames<T>> & _WcsPathAccessor<T> & _WcsDeclaredValues<T> & _WcsListedAccessors<T>} _WcsThis */
// $listKeys: { "<listPath>": "<field>" | (row) => key }（list/listKeys.ts）。
// キー指定の関数引数に文脈型を与えるためだけの宣言（noImplicitAny 下の偽エラー回避）。
/** @typedef {Record<string, string | ((row: any) => unknown)>} _WcsListKeys */
// $watch: { "<path>": (cur, prev, ...indexes) => void }（watch/processWatchDeclaration.ts）。
// ハンドラ引数に文脈型を与えるためだけの宣言（$listKeys と同じ理由）。this は ThisType<_WcsThis<T, N>> により state 型になる。
/** @typedef {Record<string, (cur: any, prev: any, ...indexes: number[]) => void>} _WcsWatch */
// $recursion: { "<anchor>": "<repeat>" }（recursion/declaration.ts）。形の検証は
// service/recursionValidator.ts（wcs/recursion-declaration-invalid）が担う。
/** @typedef {Record<string, string>} _WcsRecursion */
// $stream: { "<name>": { args?, source, fold?, initial? } }（temporal/stream.ts、4.33）。関数の引数に文脈型を与える宣言
// （$listKeys と同じ理由）: args の state は $on と同じ形、signal は AbortSignal。source は必須。
/** @template S @typedef {{ args?: (state: S) => unknown; source: (args: any, signal: AbortSignal) => unknown; fold?: (acc: any, chunk: any) => unknown; initial?: unknown }} _WcsStreamEntry */
// $on: { "<event token>": (state, event, ...indexes) => … }（token.ts — handler(state, event, ...listIndexes) と呼ばれ、
// this は undefined）。state の型は T ではなく S（引数から推論した T の写し）から作る: ハンドラの引数の型が T を
// 参照すると、TypeScript は T を推論し終える前に（引数の無い制約 Record<string, any> で）確定させ、
// state 全体の型付けが消える。S の推論は関数を unknown にした部分的なもので、state ではそれを any に読む
// （メソッドは呼べるが検査されない）。null / undefined で初期化した値は strictNullChecks が無ければ any（T と同じ広げ方。
// \`null extends string\` は strictNullChecks が無いときだけ真）。event は CustomEvent — wc-bindable の既定の getter が
// detail を読むとおり（detail は any）。CustomEvent<…> や Event への注釈も通す（双変）。
/** @template V @typedef {unknown extends V ? any : [V] extends [null | undefined] ? (null extends string ? any : V) : V} _WcsOnValue */
/** @template S @template {string} N @typedef {_WcsThis<{ [K in keyof S]: _WcsOnValue<S[K]> }, N>} _WcsOnState */
/** @template S @typedef {{ bivarianceHack(this: void, state: S, event: CustomEvent, ...indexes: number[]): unknown }["bivarianceHack"]} _WcsOnHandler */
// $behavior: その木の振る舞い（4.0 で bootstrapState から移った 3 キー。既定はどれも true）。
// 値が boolean でない形は型エラーになる。知らないキーは lint（wcs/behavior-invalid）が報告する。
/** @typedef {${BEHAVIOR_TYPE}} _WcsBehavior */
// $features: その state が要る後付け（4.0。分割 auto は読み込み、全部入り・バンドラは入っているかを検査する）。
/** @typedef {${FEATURE_NAME_TYPE}} _WcsFeatureName */
// defineState は関数の型を @type で与える（@template / @param で書いた関数宣言では、$on の state を推論するときに
// T まで確定してしまう — JavaScript の関数宣言の扱いの違い）。N は $commandTokens から推論する token の名前。
/**
@type {<T extends Record<string, any>, N extends string = string, S = T>(def: T & { [K in keyof S]: S[K] } & {
  $commandTokens?: readonly N[]; $on?: Record<string, _WcsOnHandler<_WcsOnState<S, N>>>;
  $listKeys?: _WcsListKeys; $watch?: _WcsWatch; $recursion?: _WcsRecursion; $stream?: Record<string, _WcsStreamEntry<_WcsOnState<S, N>>>;
  $behavior?: _WcsBehavior; $features?: readonly _WcsFeatureName[];
} & ThisType<_WcsThis<T, N>>) => T}
*/
const defineState = (def) => def;
export {};
// --- end preamble ---
`;

/** プリアンブルの文字数（ソースマッピングのオフセット計算用） */
export const WCS_PREAMBLE_LENGTH = WCS_PREAMBLE.length;

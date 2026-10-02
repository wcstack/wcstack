/**
 * preamble.ts
 *
 * HTML インラインスクリプト用の型定義プリアンブル。
 * 仮想 TypeScript ドキュメントの先頭に注入することで、
 * import なしで defineState() + パス型補完を提供する。
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

export const WCS_PREAMBLE = `
// --- @wcstack/state type preamble (auto-injected by vscode-wcs) ---
type _IsAny<T> = 0 extends (1 & T) ? true : false;
type _IsPlainObject<T> =
  _IsAny<T> extends true ? false :
  T extends
    | string | number | boolean | null | undefined | symbol | bigint
    | Function | Date | RegExp | Error
    | Map<any, any> | Set<any> | WeakMap<any, any> | WeakSet<any>
    | Promise<any> | readonly any[]
    ? false
    : T extends Record<string, any> ? true : false;
type _DataKeys<T> = {
  [K in keyof T & string]:
    K extends \`$\${string}\` ? never :
    _IsAny<T[K]> extends true ? K : T[K] extends Function ? never : K;
}[keyof T & string];
type _WcsPaths<T, D extends readonly any[] = []> =
  D["length"] extends 4 ? never :
  { [K in _DataKeys<T>]:
    | K
    | (T[K] extends readonly (infer E)[]
        ? _IsPlainObject<E> extends true
          ? \`\${K}.*\` | _WcsSubPaths<E, \`\${K}.*.\`, [...D, 0]>
          : \`\${K}.*\`
        : _IsPlainObject<T[K]> extends true
          ? _WcsSubPaths<T[K], \`\${K}.\`, [...D, 0]>
          : never)
  }[_DataKeys<T>];
type _WcsSubPaths<T, P extends string, D extends readonly any[]> =
  _WcsPaths<T, D> extends infer R extends string ? \`\${P}\${R}\` : never;
type _WcsPathValue<T, P extends string> =
  P extends keyof T ? T[P]
  : P extends \`\${infer K}.*\`
    ? K extends keyof T ? T[K] extends readonly (infer E)[] ? E : never : never
  : P extends \`\${infer K}.\${infer R}\`
    ? K extends keyof T
      ? T[K] extends readonly (infer E)[]
        ? R extends \`*.\${infer S}\` ? _WcsPathValue<E, S> : R extends "*" ? E : never
        : T[K] extends Record<string, any> ? _WcsPathValue<T[K], R> : never
      : never
    : never;
type _WcsPathAccessor<T> = { [P in _WcsPaths<T>]: _WcsPathValue<T, P> };
type _WcsStreamStatus = "idle" | "active" | "done" | "error";
interface WcsStateApi {
  $getAll<V = any>(path: string, indexes?: number[]): V[];
  $setAll<V = any>(path: string, indexes: number[], value: V | ((current: V, ...indexes: number[]) => V | undefined)): number;
  $setAll<V = any>(path: string, indexes: number[], values: readonly V[], options: { spread: true }): number;
  $postUpdate(path: string): void;
  $resolve(path: string, indexes: number[], value?: any): any;
  $dependOn(path: string): void;
  $untracked<T>(fn: () => T): T;
  $eq(path: string, key: unknown): boolean;
  $eqPath(path: string, keyPath: string): boolean;
  $eqIndex(path: string, level?: number): boolean;
  readonly $stateElement: HTMLElement;
  readonly $command: Record<string, { emit(...args: any[]): any }>;
  readonly $streamStatus: Record<string, _WcsStreamStatus>;
  readonly $streamError: Record<string, unknown>;
  readonly [key: \`$streamStatus.\${string}\`]: _WcsStreamStatus;
  readonly [key: \`$streamError.\${string}\`]: unknown;
  readonly $1: number; readonly $2: number; readonly $3: number;
  readonly $4: number; readonly $5: number; readonly $6: number;
  readonly $7: number; readonly $8: number; readonly $9: number;
  // $recursion 宣言済みの再帰パス（\`nodes.**.total\`）。深さの族なので \`_WcsPaths\` の
  // 有限展開には現れず、getter のキーに書いた 1 本しか T に現れない。パターン索引で
  // 「\`**\` を含むキーは読める」とだけ言う（型は any — 深さを型で表せない以上、値の型も
  // 辿れない）。パターンは \`**\` を必ず含むので、通常のドットパスの型付けは損なわない。
  readonly [key: \`\${string}.**.\${string}\`]: any;
  // 素の \`nodes.**\`（再帰 getter の中でノード自身に束縛される読み）は \`.**.\` を含まないので
  // 末尾が \`.**\` のキーにも同じ索引を置く（@wcstack/state の defineState と対）。
  readonly [key: \`\${string}.**\`]: any;
}
// $stream の値は、ランタイムが宣言キーの名前で実体化するプロパティ。T には宣言オブジェクトの中にしか
// 現れないので、getter やメソッドの this から読めるよう any で写す。initial の型は使わない — 空配列の
// initial が never[] になり、正しい読み（要素のプロパティ）まで型エラーになるため。
// T に同名のプロパティを明示的に事前宣言していれば写さない（交差でその型まで any に潰さないため）。
type _WcsDeclaredValues<T> =
  (T extends { $stream: infer S } ? { [K in Exclude<keyof S & string, keyof T>]: any } : {});
type _WcsThis<T> = T & WcsStateApi & _WcsPathAccessor<T> & _WcsDeclaredValues<T>;
// $listKeys: { "<listPath>": "<field>" | (row) => key }（list/listKeys.ts）。
// キー指定の関数引数に文脈型を与えるためだけの宣言（noImplicitAny 下の偽エラー回避）。
type _WcsListKeys = Record<string, string | ((row: any) => unknown)>;
// $watch: { "<path>": (cur, prev, ...indexes) => void }（watch/processWatchDeclaration.ts）。
// ハンドラ引数に文脈型を与えるためだけの宣言（$listKeys と同じ理由）。
// this は ThisType<_WcsThis<T>> により state 型になる。
type _WcsWatch = Record<string, (cur: any, prev: any, ...indexes: number[]) => void>;
// $recursion: { "<anchor>": "<repeat>" }（recursion/declaration.ts）。初版は単一の自己再帰
// のみで、アンカーも反復サブパスも「固定プロパティ列 + 末尾の .*」に限る。形の検証は
// service/recursionValidator.ts（wcs/recursion-declaration-invalid）が担う。
type _WcsRecursion = Record<string, string>;
// $behavior: その木の振る舞い（4.0 で bootstrapState から移った 3 キー。既定はどれも true）。
// 値が boolean でない形は型エラーになる。知らないキーは lint（wcs/behavior-invalid）が報告する。
type _WcsBehavior = ${BEHAVIOR_TYPE};
// $features: その state が要る後付け（4.0。分割 auto は読み込み、全部入り・バンドラは入っているかを検査する）。
type _WcsFeatureName = ${FEATURE_NAME_TYPE};
function defineState<T extends Record<string, any>>(
  def: T & {
    $listKeys?: _WcsListKeys; $watch?: _WcsWatch; $recursion?: _WcsRecursion;
    $behavior?: _WcsBehavior; $features?: readonly _WcsFeatureName[];
  } & ThisType<_WcsThis<T>>
): T { return def; }
// --- end preamble ---
`;

/** プリアンブルの文字数（ソースマッピングのオフセット計算用） */
export const WCS_PREAMBLE_LENGTH = WCS_PREAMBLE.length;

/**
 * preamble.ts
 *
 * HTML インラインスクリプト用の型定義プリアンブル。
 * 仮想 TypeScript ドキュメントの先頭に注入することで、
 * import なしで defineState() + パス型補完を提供する。
 *
 * @wcstack/state の defineState.ts と同等の型を含む。
 */

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
  /** @deprecated $dependOn の旧名（@wcstack/state 3.2 — 4.0 で外れる） */
  $trackDependency(path: string): void;
  /** @deprecated $untracked の旧名（@wcstack/state 3.2 — 4.0 で外れる） */
  $untrackDependency<T>(fn: () => T): T;
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
// $scan の出力と $streams の値は、ランタイムが宣言キーの名前で実体化するプロパティ。T には宣言
// オブジェクトの中にしか現れないので、getter やメソッドの this から読めるよう any で写す。initial の
// 型は使わない — 空配列の initial が never[] になり、正しい読み（要素のプロパティ）まで型エラーになるため。
// T に同名のプロパティを明示的に事前宣言していれば写さない（交差でその型まで any に潰さないため）。
type _WcsDeclaredValues<T> =
  (T extends { $scan: infer S } ? { [K in Exclude<keyof S & string, keyof T>]: any } : {}) &
  (T extends { $stream: infer S } ? { [K in Exclude<keyof S & string, keyof T>]: any } : {}) &
  (T extends { $streams: infer S } ? { [K in Exclude<keyof S & string, keyof T>]: any } : {});
type _WcsThis<T> = T & WcsStateApi & _WcsPathAccessor<T> & _WcsDeclaredValues<T>;
// $listKeys: { "<listPath>": "<field>" | (row) => key }（list/listKeys.ts）。
// キー指定の関数引数に文脈型を与えるためだけの宣言（noImplicitAny 下の偽エラー回避）。
type _WcsListKeys = Record<string, string | ((row: any) => unknown)>;
// $watch: { "<path>": (cur, prev, ...indexes) => void }（watch/processWatchDeclaration.ts）。
// ハンドラ引数に文脈型を与えるためだけの宣言（$listKeys と同じ理由）。
// this は ThisType<_WcsThis<T>> により state 型になる。
type _WcsWatch = Record<string, (cur: any, prev: any, ...indexes: number[]) => void>;
// $scan: { "<output>": { from | on, initial, fold, resetOn? } }（scan/processScanDeclaration.ts）。
// fold の引数に文脈型を与えるためだけの宣言。from と on で第 2 引数の意味が変わる（cur か event）ので
// 引数は any に倒す。fold に this は渡らない（ランタイムは this 無しで呼ぶ）ので this: void と書く —
// 書かないと defineState の ThisType がメソッド形の fold にも state 型の this を与えてしまう。
type _WcsScan = Record<string, {
  from?: string;
  on?: string;
  initial: any;
  fold: (this: void, acc: any, ...args: any[]) => any;
  resetOn?: string[];
}>;
// $recursion: { "<anchor>": "<repeat>" }（recursion/declaration.ts）。初版は単一の自己再帰
// のみで、アンカーも反復サブパスも「固定プロパティ列 + 末尾の .*」に限る。形の検証は
// service/recursionValidator.ts（wcs/recursion-declaration-invalid）が担う。
type _WcsRecursion = Record<string, string>;
function defineState<T extends Record<string, any>>(
  def: T & { $listKeys?: _WcsListKeys; $watch?: _WcsWatch; $scan?: _WcsScan; $recursion?: _WcsRecursion } & ThisType<_WcsThis<T>>
): T { return def; }
// --- end preamble ---
`;

/** プリアンブルの文字数（ソースマッピングのオフセット計算用） */
export const WCS_PREAMBLE_LENGTH = WCS_PREAMBLE.length;

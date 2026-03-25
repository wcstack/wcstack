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
  [K in keyof T & string]: _IsAny<T[K]> extends true ? K : T[K] extends Function ? never : K;
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
interface WcsStateApi {
  $getAll<V = any>(path: string, defaultValue?: V[]): V[];
  $postUpdate(path: string): void;
  $resolve(path: string, indexes: number[], value?: any): any;
  $trackDependency(path: string): void;
  readonly $stateElement: HTMLElement;
  readonly $1: number; readonly $2: number; readonly $3: number;
  readonly $4: number; readonly $5: number; readonly $6: number;
  readonly $7: number; readonly $8: number; readonly $9: number;
}
type _WcsThis<T> = T & WcsStateApi & _WcsPathAccessor<T>;
function defineState<T extends Record<string, any>>(def: T & ThisType<_WcsThis<T>>): T { return def; }
// --- end preamble ---
`;

/** プリアンブルの文字数（ソースマッピングのオフセット計算用） */
export const WCS_PREAMBLE_LENGTH = WCS_PREAMBLE.length;

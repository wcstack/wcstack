export { IFilterInfo, IBindingInfo, BindingType } from './binding/types.js';

export interface IState {
  [key: string]: any;
} 

export interface ITagNames {
  readonly state: string;
  readonly ssr: string;
}

export interface IWritableTagNames {
  state?: string;
  ssr?: string;
}

export interface IConfig {
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

export interface IWritableConfig {
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

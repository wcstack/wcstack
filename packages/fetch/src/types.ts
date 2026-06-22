export interface ITagNames {
  readonly fetch: string;
  readonly fetchHeader: string;
  readonly fetchBody: string;
  readonly infiniteScroll: string;
}

export interface IWritableTagNames {
  fetch?: string;
  fetchHeader?: string;
  fetchBody?: string;
  infiniteScroll?: string;
}

export interface IConfig {
  readonly autoTrigger: boolean;
  readonly triggerAttribute: string;
  readonly tagNames: ITagNames;
}

export interface IWritableConfig {
  autoTrigger?: boolean;
  triggerAttribute?: string;
  tagNames?: IWritableTagNames;
}

// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

/**
 * HTTP error returned when the server responds with a non-ok status (>= 400).
 */
export interface WcsFetchHttpError {
  status: number;
  statusText: string;
  body: string;
}

/**
 * Value types for FetchCore (headless) — the 4 async state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * interface User { id: number; name: string; }
 * const core = new FetchCore();
 * bind(core, (name: keyof WcsFetchCoreValues<User>, value) => { ... });
 * ```
 */
export interface WcsFetchCoreValues<T = unknown> {
  value: T;
  loading: boolean;
  error: WcsFetchHttpError | Error | null;
  status: number;
}

/**
 * Value types for the Shell (`<wcs-fetch>`) — extends Core with `trigger`.
 * Use with framework adapters for compile-time type checking.
 *
 * @example
 * ```tsx
 * // React
 * interface User { id: number; name: string; }
 * const [ref, values] = useWcBindable<HTMLElement, WcsFetchValues<User>>();
 * values.value   // User
 * values.loading // boolean
 * ```
 */
export interface WcsFetchValues<T = unknown> extends WcsFetchCoreValues<T> {
  trigger: boolean;
}

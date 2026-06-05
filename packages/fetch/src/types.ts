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

// wc-bindable protocol (@wc-bindable/core, protocol version 1) for custom element binding.
// properties: observable outputs — the element dispatches events on change, observers subscribe via bind()
// inputs:     settable surface — declarative metadata; optional `attribute` hints the mirrored HTML attribute
// commands:   invocable methods — declarative metadata; binding systems call the method by name
// Per SPEC.md, core interprets only `properties`; `inputs` / `commands` and the `attribute` / `async`
// hints are descriptive (tooling, codegen, remote proxying). See SPEC-extensions.md § Extension 1.
export interface IWcBindableProperty {
  readonly name: string;
  readonly event: string;
  readonly getter?: (event: Event) => any;
}

export interface IWcBindableInput {
  readonly name: string;
  readonly attribute?: string;
}

export interface IWcBindableCommand {
  readonly name: string;
  readonly async?: boolean;
}

export interface IWcBindable {
  readonly protocol: "wc-bindable";
  readonly version: 1;
  readonly properties: IWcBindableProperty[];
  readonly inputs?: readonly IWcBindableInput[];
  readonly commands?: readonly IWcBindableCommand[];
}

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
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
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

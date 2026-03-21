export interface ITagNames {
  readonly fetch: string;
  readonly fetchHeader: string;
  readonly fetchBody: string;
}

export interface IWritableTagNames {
  fetch?: string;
  fetchHeader?: string;
  fetchBody?: string;
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

export interface IWcBindableProperty {
  readonly name: string;
  readonly event: string;
  readonly getter?: (event: Event) => any;
}

export interface IWcBindable {
  readonly protocol: "wc-bindable";
  readonly version: number;
  readonly properties: IWcBindableProperty[];
}

/**
 * Value types for FetchCore (headless) — the 4 async state properties.
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new FetchCore();
 * bind(core, (name: keyof WcsFetchCoreValues, value) => { ... });
 * ```
 */
export interface WcsFetchCoreValues {
  value: unknown;
  loading: boolean;
  error: { status: number; statusText: string; body: string } | null;
  status: number;
}

/**
 * Value types for the Shell (`<wcs-fetch>`) — extends Core with `trigger`.
 * Use with framework adapters for compile-time type checking.
 *
 * @example
 * ```tsx
 * // React
 * const [ref, values] = useWcBindable<HTMLElement, WcsFetchValues>();
 * values.loading // boolean
 * ```
 */
export interface WcsFetchValues extends WcsFetchCoreValues {
  trigger: boolean;
}

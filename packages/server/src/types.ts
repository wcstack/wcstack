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
 * Value types for RenderCore (headless) — the 3 async state properties.
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new RenderCore();
 * bind(core, (name: keyof WcsRenderValues, value) => { ... });
 * ```
 */
export interface WcsRenderValues {
  html: string | null;
  loading: boolean;
  error: Error | null;
}

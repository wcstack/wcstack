// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

/**
 * Value types for RenderCore (headless) — the 3 async state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
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

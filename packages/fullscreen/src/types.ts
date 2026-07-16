import type { WcsIoErrorInfo } from "./core/platformCapability.js";

export interface ITagNames {
  readonly fullscreen: string;
}

export interface IWritableTagNames {
  fullscreen?: string;
}

export interface IConfig {
  readonly tagNames: ITagNames;
}

export interface IWritableConfig {
  tagNames?: IWritableTagNames;
}

// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

/**
 * Value types for FullscreenCore (headless) — the Core's readable value
 * surface. `active`, `error`, and `errorInfo` are all *observable* (declared in
 * `wcBindable.properties` with change events: `wcs-fullscreen:change` /
 * `:error` / `:error-info-changed`), so a wc-bindable binding core delivers a
 * request/exit failure. `errorInfo` is the additive serializable failure
 * taxonomy derived from `error` (docs/fullscreen-tag-design.md §8, README).
 *
 * @example
 * ```typescript
 * const core = new FullscreenCore();
 * bind(core, (name: keyof WcsFullscreenCoreValues, value) => { ... });
 * ```
 */
export interface WcsFullscreenCoreValues {
  active: boolean;
  error: any;
  /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
  errorInfo: WcsIoErrorInfo | null;
}

/**
 * Value types for the Shell (`<wcs-fullscreen target="...">`) — identical
 * value surface to the Core (`active` / `error` / `errorInfo` all observable).
 * The Shell adds the `target` input (attribute-mirrored) that resolves which
 * element requestFullscreen()/exitFullscreen() operate on
 * (docs/fullscreen-tag-design.md §1/§9).
 */
export type WcsFullscreenValues = WcsFullscreenCoreValues;

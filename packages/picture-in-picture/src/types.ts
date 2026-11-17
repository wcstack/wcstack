import type { WcsIoErrorInfo } from "./core/platformCapability.js";

export interface ITagNames {
  readonly pip: string;
}

export interface IWritableTagNames {
  pip?: string;
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
 * Value types for PipCore (headless) — the Core's readable value surface.
 * `active`, `error`, and `errorInfo` are all *observable* (declared in
 * `wcBindable.properties` with change events: `wcs-pip:change` / `:error` /
 * `:error-info-changed`), so a wc-bindable binding core delivers a request/exit
 * failure. `errorInfo` is the additive serializable failure taxonomy derived
 * from `error` (README "Output state"). `supported`
 * (`wcs-pip:supported-changed`) says whether this page can use
 * Picture-in-Picture at all.
 *
 * @example
 * ```typescript
 * const core = new PipCore();
 * bind(core, (name: keyof WcsPipCoreValues, value) => { ... });
 * ```
 */
export interface WcsPipCoreValues {
  active: boolean;
  error: any;
  /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
  errorInfo: WcsIoErrorInfo | null;
  /** Whether this page can use Picture-in-Picture (API present, not forbidden by a policy). */
  supported: boolean;
}

/**
 * Value types for the Shell (`<wcs-pip>`) — identical value surface to the
 * Core (`active` / `error` / `errorInfo` / `supported` all observable). The Shell adds the
 * `target` input (attribute-mirrored) and no additional observable
 * properties.
 */
export type WcsPipValues = WcsPipCoreValues;

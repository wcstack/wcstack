export interface ITagNames {
  readonly network: string;
}

export interface IWritableTagNames {
  network?: string;
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
 * A single snapshot of `navigator.connection` (Network Information API), or the
 * unsupported default. `effectiveType`/`downlink`/`rtt`/`saveData` are `null`
 * when the API is absent (`supported === false`) — and each also normalizes to
 * `null` individually, even while `supported` is `true`, when the browser
 * reports that field as missing or with an unexpected type; `downlinkMax` and
 * `type` are intentionally not surfaced (see docs/network-tag-design.md §2).
 */
export interface WcsNetworkSnapshot {
  effectiveType: string | null;
  downlink: number | null;
  rtt: number | null;
  saveData: boolean | null;
  supported: boolean;
}

/**
 * Value types for NetworkCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new NetworkCore();
 * bind(core, (name: keyof WcsNetworkCoreValues, value) => { ... });
 * ```
 */
export type WcsNetworkCoreValues = WcsNetworkSnapshot;

/**
 * Value types for the Shell (`<wcs-network>`) — identical observable surface to
 * the Core. The Shell adds no inputs and no commands: `navigator.connection` is a
 * single global with nothing to configure and no request()-style action.
 */
export type WcsNetworkValues = WcsNetworkCoreValues;

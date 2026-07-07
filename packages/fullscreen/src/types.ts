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
 * surface. Note that only `active` is *observable* (declared in
 * `wcBindable.properties` with a change event); `error` is an
 * imperative-read-only getter with no event of its own — a wc-bindable
 * binding core will never deliver it, so read it after a command settles
 * (docs/fullscreen-tag-design.md §8, README "Notes & limitations").
 *
 * @example
 * ```typescript
 * const core = new FullscreenCore();
 * // bind() only ever delivers "active" — see the note above about "error".
 * bind(core, (name: keyof WcsFullscreenCoreValues, value) => { ... });
 * ```
 */
export interface WcsFullscreenCoreValues {
  active: boolean;
  error: any;
}

/**
 * Value types for the Shell (`<wcs-fullscreen target="...">`) — identical
 * value surface to the Core (same caveat: only `active` is observable).
 * The Shell adds the `target` input (attribute-mirrored) that resolves which
 * element requestFullscreen()/exitFullscreen() operate on
 * (docs/fullscreen-tag-design.md §1/§9).
 */
export type WcsFullscreenValues = WcsFullscreenCoreValues;

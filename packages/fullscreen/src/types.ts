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
 * Value types for FullscreenCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
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
}

/**
 * Value types for the Shell (`<wcs-fullscreen target="...">`) — identical
 * observable surface to the Core. The Shell adds the `target` input (attribute-
 * mirrored) that resolves which element requestFullscreen()/exitFullscreen()
 * operate on (docs/fullscreen-tag-design.md §1/§9).
 */
export type WcsFullscreenValues = WcsFullscreenCoreValues;

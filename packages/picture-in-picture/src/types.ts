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
 * Value types for PipCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
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
}

/**
 * Value types for the Shell (`<wcs-pip>`) — identical observable surface to
 * the Core. The Shell adds the `target` input (attribute-mirrored) and no
 * additional observable properties.
 */
export type WcsPipValues = WcsPipCoreValues;

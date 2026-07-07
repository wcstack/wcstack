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
 * Note that only `active` is *observable* (declared in
 * `wcBindable.properties` with a change event); `error` is an
 * imperative-read-only getter with no event of its own — a wc-bindable
 * binding core will never deliver it, so read it after a command settles
 * (docs/picture-in-picture-tag-design.md, README "Notes & limitations").
 *
 * @example
 * ```typescript
 * const core = new PipCore();
 * // bind() only ever delivers "active" — see the note above about "error".
 * bind(core, (name: keyof WcsPipCoreValues, value) => { ... });
 * ```
 */
export interface WcsPipCoreValues {
  active: boolean;
  error: any;
}

/**
 * Value types for the Shell (`<wcs-pip>`) — identical value surface to the
 * Core (same caveat: only `active` is observable). The Shell adds the
 * `target` input (attribute-mirrored) and no additional observable
 * properties.
 */
export type WcsPipValues = WcsPipCoreValues;

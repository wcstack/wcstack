export interface ITagNames {
  readonly pointerLock: string;
}

export interface IWritableTagNames {
  pointerLock?: string;
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
 * Value types for PointerLockCore (headless) — the Core's readable value
 * surface. Note that only `active` is *observable* (declared in
 * `wcBindable.properties` with a change event); `error` is an
 * imperative-read-only getter with no event of its own — a wc-bindable
 * binding core will never deliver it, so read it after a command settles
 * (docs/pointer-lock-tag-design.md §2, docs/fullscreen-tag-design.md §8).
 *
 * @example
 * ```typescript
 * const core = new PointerLockCore();
 * // bind() only ever delivers "active" — see the note above about "error".
 * bind(core, (name: keyof WcsPointerLockCoreValues, value) => { ... });
 * ```
 */
export interface WcsPointerLockCoreValues {
  active: boolean;
  error: any;
}

/**
 * Value types for the Shell (`<wcs-pointer-lock>`) — identical value surface
 * to the Core (same caveat: only `active` is observable). The Shell
 * additionally accepts a `target` attribute
 * (see docs/pointer-lock-tag-design.md / docs/fullscreen-tag-design.md §1).
 */
export type WcsPointerLockValues = WcsPointerLockCoreValues;

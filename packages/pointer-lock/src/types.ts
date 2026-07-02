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
 * Value types for PointerLockCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new PointerLockCore();
 * bind(core, (name: keyof WcsPointerLockCoreValues, value) => { ... });
 * ```
 */
export interface WcsPointerLockCoreValues {
  active: boolean;
  error: any;
}

/**
 * Value types for the Shell (`<wcs-pointer-lock>`) — identical observable
 * surface to the Core. The Shell additionally accepts a `target` attribute
 * (see docs/pointer-lock-tag-design.md / docs/fullscreen-tag-design.md §1).
 */
export type WcsPointerLockValues = WcsPointerLockCoreValues;

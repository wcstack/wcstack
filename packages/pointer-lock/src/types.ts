import type { WcsIoErrorInfo } from "./core/platformCapability.js";

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
 * surface. `active`, `error`, and `errorInfo` are all *observable* (declared in
 * `wcBindable.properties` with change events: `wcs-pointer-lock:change` /
 * `:error` / `:error-info-changed`), so a wc-bindable binding core delivers a
 * request/exit failure. `errorInfo` is the additive serializable failure
 * taxonomy derived from `error` (docs/pointer-lock-tag-design.md §2, README).
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
  /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
  errorInfo: WcsIoErrorInfo | null;
}

/**
 * Value types for the Shell (`<wcs-pointer-lock>`) — identical value surface
 * to the Core (`active` / `error` / `errorInfo` all observable). The Shell
 * additionally accepts a `target` attribute
 * (see docs/pointer-lock-tag-design.md / docs/fullscreen-tag-design.md §1).
 */
export type WcsPointerLockValues = WcsPointerLockCoreValues;

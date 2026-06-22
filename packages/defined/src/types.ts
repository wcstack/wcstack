export interface ITagNames {
  readonly defined: string;
}

export interface IWritableTagNames {
  defined?: string;
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
 * Aggregation mode across the watched tags:
 * - `"all"` — `defined` is true only once every tag has been registered.
 * - `"any"` — `defined` is true as soon as the first tag is registered.
 */
export type DefinedMode = "all" | "any";

/**
 * The state snapshot carried in every `wcs-defined:change` event `detail`. The
 * wc-bindable getters read each field from this object, so all six observable
 * properties are derived from a single event (mirroring how PermissionCore
 * exposes granted/denied/… from one `change` event).
 *
 * Invariant: `total === count + pending.length + missing.length` holds at every
 * dispatch. `pending` and `missing` partition the not-yet-defined tags, split by
 * the timeout: pending = still waiting (pre-timeout), missing = given up
 * (post-timeout) or undefinable (invalid name).
 */
export interface DefinedSnapshot {
  defined: boolean;
  pending: string[];
  missing: string[];
  count: number;
  total: number;
  error: string | null;
}

/**
 * Value types for DefinedCore (headless) — the observable state properties. Use
 * with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new DefinedCore(["my-chart", "my-grid"], "all", 3000);
 * bind(core, (name: keyof WcsDefinedCoreValues, value) => { ... });
 * ```
 */
export interface WcsDefinedCoreValues {
  defined: boolean;
  pending: string[];
  missing: string[];
  count: number;
  total: number;
  error: string | null;
}

/**
 * Value types for the Shell (`<wcs-defined>`) — identical observable surface to
 * the Core. The Shell adds no command-property: `whenDefined` is a pure observer,
 * so this element is a one-way element → state monitor (event-token only).
 */
export type WcsDefinedValues = WcsDefinedCoreValues;

/**
 * Settable input surface for the Shell (`<wcs-defined>`) — the attributes that
 * configure what is watched. Mirrors the `inputs` entries of the wc-bindable
 * manifest; use it for compile-time typing when a binding system or tooling
 * writes these declaratively.
 */
export interface WcsDefinedInputs {
  tags: string;     // comma-separated custom element tag names
  mode: DefinedMode;
  timeout: number;  // milliseconds; 0 / unset means wait forever
}

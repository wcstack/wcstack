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

// wc-bindable protocol (@wc-bindable/core, protocol version 1) for custom element binding.
// properties: observable outputs — the element dispatches events on change, observers subscribe via bind()
// inputs:     settable surface — declarative metadata; optional `attribute` hints the mirrored HTML attribute
// commands:   invocable methods — declarative metadata; binding systems call the method by name
// Per SPEC.md, core interprets only `properties`; `inputs` / `commands` and the `attribute` / `async`
// hints are descriptive (tooling, codegen, remote proxying). See SPEC-extensions.md § Extension 1.
export interface IWcBindableProperty {
  readonly name: string;
  readonly event: string;
  readonly getter?: (event: Event) => any;
}

export interface IWcBindableInput {
  readonly name: string;
  readonly attribute?: string;
}

export interface IWcBindableCommand {
  readonly name: string;
  readonly async?: boolean;
}

export interface IWcBindable {
  readonly protocol: "wc-bindable";
  readonly version: number;
  readonly properties: IWcBindableProperty[];
  readonly inputs?: IWcBindableInput[];
  readonly commands?: IWcBindableCommand[];
}

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
 * with `bind()` from `@wc-bindable/core` for compile-time type checking.
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

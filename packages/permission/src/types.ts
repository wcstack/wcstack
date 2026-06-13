export interface ITagNames {
  readonly permission: string;
}

export interface IWritableTagNames {
  permission?: string;
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
 * Permission state mirroring the Permissions API `PermissionState`
 * (`"prompt"` / `"granted"` / `"denied"`) plus `"unsupported"` for environments
 * without `navigator.permissions`, or where the requested permission name cannot
 * be queried (the browser rejects the descriptor). This is the same four-value
 * surface used by `@wcstack/geolocation` and `@wcstack/clipboard`.
 */
export type PermissionStateOrUnsupported = "prompt" | "granted" | "denied" | "unsupported";

/**
 * Descriptor passed to `navigator.permissions.query()`. `name` is the permission
 * name (e.g. `"geolocation"`, `"notifications"`, `"camera"`). The optional fields
 * cover the descriptors that take extra members:
 * - `userVisibleOnly` — required by the `"push"` permission.
 * - `sysex` — used by the `"midi"` permission.
 *
 * Other members defined by future descriptors are allowed via the index
 * signature so the Shell can forward unknown attributes without a type change.
 */
export interface WcsPermissionDescriptor {
  name: string;
  userVisibleOnly?: boolean;
  sysex?: boolean;
  [key: string]: unknown;
}

/**
 * Value types for PermissionCore (headless) — the observable state properties.
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new PermissionCore({ name: "geolocation" });
 * bind(core, (name: keyof WcsPermissionCoreValues, value) => { ... });
 * ```
 */
export interface WcsPermissionCoreValues {
  state: PermissionStateOrUnsupported;
  granted: boolean;
  denied: boolean;
  prompt: boolean;
  unsupported: boolean;
}

/**
 * Value types for the Shell (`<wcs-permission>`) — identical observable surface
 * to the Core. The Shell adds no command-property: the Permissions API is
 * read-only, so this element is a pure element → state monitor.
 */
export type WcsPermissionValues = WcsPermissionCoreValues;

/**
 * Settable input surface for the Shell (`<wcs-permission>`) — the descriptor
 * members exposed as attributes (`name`, `user-visible-only`, `sysex`). Mirrors
 * the `inputs` entries of the wc-bindable manifest; use it for compile-time typing
 * when a binding system or tooling writes these declaratively.
 */
export interface WcsPermissionInputs {
  name: string;
  userVisibleOnly: boolean;
  sysex: boolean;
}

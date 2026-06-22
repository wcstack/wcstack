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

// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

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
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
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

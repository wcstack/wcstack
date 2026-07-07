export interface ITagNames {
  readonly tilt: string;
}

export interface IWritableTagNames {
  tilt?: string;
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
 * 3-value vocabulary, deliberately distinct from the 4-value permission state
 * (prompt/granted/denied/unsupported) used elsewhere: `"unknown"` means
 * "no gating exists on this platform, so there is nothing to have asked"
 * (docs/device-orientation-tag-design.md §2) — not the same concept as
 * Permissions API's `"prompt"`.
 */
export type TiltPermissionState = "granted" | "denied" | "unknown";

/**
 * Value types for TiltCore (headless) — the observable state properties.
 */
export interface WcsTiltCoreValues {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute: boolean | null;
  permissionState: TiltPermissionState;
  error: any;
}

/**
 * Value types for the Shell (`<wcs-tilt>`) — identical observable surface to
 * the Core.
 */
export type WcsTiltValues = WcsTiltCoreValues;

import type { WcsIoErrorInfo } from "./core/platformCapability.js";

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
 * "the browser has not answered" — nothing was asked yet, or the browser
 * refused to ask (docs/device-orientation-tag-design.md §2) — not the same
 * concept as Permissions API's `"prompt"`.
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
  /** Degrees clockwise from north of the direction the top of the device points, or null until known. */
  heading: number | null;
  permissionState: TiltPermissionState;
  error: any;
  /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
  errorInfo: WcsIoErrorInfo | null;
  /** This page can use Device Orientation (the API is there and the page is not forbidden to use it). */
  supported: boolean;
}

/**
 * Value types for the Shell (`<wcs-tilt>`) — identical observable surface to
 * the Core.
 */
export type WcsTiltValues = WcsTiltCoreValues;

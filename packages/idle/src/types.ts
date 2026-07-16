import type { WcsIoErrorInfo } from "./core/platformCapability.js";

export interface ITagNames {
  readonly idle: string;
}

export interface IWritableTagNames {
  idle?: string;
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

export type IdleUserState = "active" | "idle";
export type IdleScreenState = "locked" | "unlocked";

/**
 * Value types for IdleCore (headless) — the observable state properties.
 * Permission state (granted/denied/prompt) is intentionally NOT included here
 * — compose with `<wcs-permission name="idle-detection">` instead
 * (docs/idle-detection-tag-design.md §0/§2).
 */
export interface WcsIdleCoreValues {
  userState: IdleUserState | null;
  screenState: IdleScreenState | null;
  active: boolean;
  error: any;
  /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
  errorInfo: WcsIoErrorInfo | null;
}

/**
 * Value types for the Shell (`<wcs-idle>`) — identical observable surface to
 * the Core.
 */
export type WcsIdleValues = WcsIdleCoreValues;

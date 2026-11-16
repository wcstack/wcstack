import type { WcsIoErrorInfo } from "./core/platformCapability.js";

export interface ITagNames {
  readonly gyroscope: string;
}

export interface IWritableTagNames {
  gyroscope?: string;
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
 * A single `reading` sample from the Gyroscope sensor: angular velocity
 * around the x/y/z axes, in radians per second (rad/s). On the `devicemotion`
 * fallback it is the event's `rotationRate` (degrees per second) converted.
 */
export interface WcsGyroscopeReading {
  x: number | null;
  y: number | null;
  z: number | null;
}

/**
 * Error detail published on the `wcs-gyroscope:error` event. Mirrors the
 * Generic Sensor API's `SensorErrorEvent.error` (a `DOMException`-like value)
 * flattened to a plain object, plus the synthetic `"unsupported"` name used
 * when the browser has neither the global `Gyroscope` constructor nor
 * `DeviceMotionEvent`.
 */
export interface WcsGyroscopeErrorDetail {
  error: string;
  message: string;
}

/**
 * What the browser answered to `requestPermission()`. `"unknown"` until it
 * answers: nothing was asked yet, or the browser refused to ask (iOS, outside a
 * tap). The same 3-value vocabulary as `<wcs-tilt>` — not the Permissions API's
 * state, which `<wcs-permission name="gyroscope">` reports.
 */
export type WcsGyroscopePermissionState = "granted" | "denied" | "unknown";

/**
 * Value types for GyroscopeCore (headless) — the observable state
 * properties. Use with `bind()` from a wc-bindable binding core for
 * compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new GyroscopeCore();
 * bind(core, (name: keyof WcsGyroscopeCoreValues, value) => { ... });
 * ```
 */
export interface WcsGyroscopeCoreValues extends WcsGyroscopeReading {
  permissionState: WcsGyroscopePermissionState;
  error: WcsGyroscopeErrorDetail | null;
  /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
  errorInfo: WcsIoErrorInfo | null;
  /** This page can use the sensor (an API is there and the page is not forbidden to use it). */
  supported: boolean;
}

/**
 * Value types for the Shell (`<wcs-gyroscope>`) — identical observable
 * surface to the Core, plus the `frequency` attribute-backed input.
 */
export type WcsGyroscopeValues = WcsGyroscopeCoreValues;

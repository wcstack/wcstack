import type { WcsIoErrorInfo } from "./core/platformCapability.js";

export interface ITagNames {
  readonly accelerometer: string;
}

export interface IWritableTagNames {
  accelerometer?: string;
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
 * A single `reading` sample from the Accelerometer sensor: linear acceleration
 * along the x/y/z axes, in m/s^2 (including gravity — this is the plain
 * `Accelerometer`, not `LinearAccelerationSensor`). On the `devicemotion`
 * fallback it is the event's `accelerationIncludingGravity`.
 */
export interface WcsAccelerometerReading {
  x: number | null;
  y: number | null;
  z: number | null;
}

/**
 * Error detail published on the `wcs-accelerometer:error` event. Mirrors the
 * Generic Sensor API's `SensorErrorEvent.error` (a `DOMException`-like value)
 * flattened to a plain object, plus the synthetic `"unsupported"` name used
 * when the browser has neither the global `Accelerometer` constructor nor
 * `DeviceMotionEvent`.
 */
export interface WcsAccelerometerErrorDetail {
  error: string;
  message: string;
}

/**
 * What the browser answered to `requestPermission()`. `"unknown"` until it
 * answers: nothing was asked yet, or the browser refused to ask (iOS, outside a
 * tap). The same 3-value vocabulary as `<wcs-tilt>` — not the Permissions API's
 * state, which `<wcs-permission name="accelerometer">` reports.
 */
export type WcsAccelerometerPermissionState = "granted" | "denied" | "unknown";

/**
 * Value types for AccelerometerCore (headless) — the observable state
 * properties. Use with `bind()` from a wc-bindable binding core for
 * compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new AccelerometerCore();
 * bind(core, (name: keyof WcsAccelerometerCoreValues, value) => { ... });
 * ```
 */
export interface WcsAccelerometerCoreValues extends WcsAccelerometerReading {
  permissionState: WcsAccelerometerPermissionState;
  error: WcsAccelerometerErrorDetail | null;
  /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
  errorInfo: WcsIoErrorInfo | null;
  /** This page can use the sensor (an API is there and the page is not forbidden to use it). */
  supported: boolean;
}

/**
 * Value types for the Shell (`<wcs-accelerometer>`) — identical observable
 * surface to the Core, plus the `frequency` attribute-backed input.
 */
export type WcsAccelerometerValues = WcsAccelerometerCoreValues;

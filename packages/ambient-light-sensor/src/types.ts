import type { WcsIoErrorInfo } from "./core/platformCapability.js";

export interface ITagNames {
  readonly ambientLightSensor: string;
}

export interface IWritableTagNames {
  ambientLightSensor?: string;
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
 * A single `reading` sample from the AmbientLightSensor sensor: ambient light
 * level in lux. Unlike Accelerometer/Gyroscope/Magnetometer (x/y/z axes),
 * AmbientLightSensor reports a single scalar (docs/sensor-tag-design.md §2).
 */
export interface WcsAmbientLightSensorReading {
  illuminance: number | null;
}

/**
 * Error detail published on the `wcs-ambient-light-sensor:error` event. Mirrors the
 * Generic Sensor API's `SensorErrorEvent.error` (a `DOMException`-like value)
 * flattened to a plain object, plus the synthetic `"unsupported"` name used
 * when the global `AmbientLightSensor` constructor is absent.
 */
export interface WcsAmbientLightSensorErrorDetail {
  error: string;
  message: string;
}

/**
 * Value types for AmbientLightSensorCore (headless) — the observable state
 * properties. Use with `bind()` from a wc-bindable binding core for
 * compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new AmbientLightSensorCore();
 * bind(core, (name: keyof WcsAmbientLightSensorCoreValues, value) => { ... });
 * ```
 */
export interface WcsAmbientLightSensorCoreValues extends WcsAmbientLightSensorReading {
  error: WcsAmbientLightSensorErrorDetail | null;
  /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
  errorInfo: WcsIoErrorInfo | null;
}

/**
 * Value types for the Shell (`<wcs-ambient-light-sensor>`) — identical observable
 * surface to the Core, plus the `frequency` attribute-backed input.
 */
export type WcsAmbientLightSensorValues = WcsAmbientLightSensorCoreValues;

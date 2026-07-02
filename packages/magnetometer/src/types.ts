export interface ITagNames {
  readonly magnetometer: string;
}

export interface IWritableTagNames {
  magnetometer?: string;
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
 * A single `reading` sample from the Magnetometer sensor: magnetic flux
 * density along the x/y/z axes, in microtesla (µT).
 */
export interface WcsMagnetometerReading {
  x: number | null;
  y: number | null;
  z: number | null;
}

/**
 * Error detail published on the `wcs-magnetometer:error` event. Mirrors the
 * Generic Sensor API's `SensorErrorEvent.error` (a `DOMException`-like value)
 * flattened to a plain object, plus the synthetic `"unsupported"` name used
 * when the global `Magnetometer` constructor is absent.
 */
export interface WcsMagnetometerErrorDetail {
  error: string;
  message: string;
}

/**
 * Value types for MagnetometerCore (headless) — the observable state
 * properties. Use with `bind()` from a wc-bindable binding core for
 * compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new MagnetometerCore();
 * bind(core, (name: keyof WcsMagnetometerCoreValues, value) => { ... });
 * ```
 */
export interface WcsMagnetometerCoreValues extends WcsMagnetometerReading {
  error: WcsMagnetometerErrorDetail | null;
}

/**
 * Value types for the Shell (`<wcs-magnetometer>`) — identical observable
 * surface to the Core, plus the `frequency` attribute-backed input.
 */
export type WcsMagnetometerValues = WcsMagnetometerCoreValues;

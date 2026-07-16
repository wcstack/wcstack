import type { WcsIoErrorInfo } from "./core/platformCapability.js";

export interface ITagNames {
  readonly geo: string;
}

export interface IWritableTagNames {
  geo?: string;
}

export interface IConfig {
  readonly autoTrigger: boolean;
  readonly triggerAttribute: string;
  readonly tagNames: ITagNames;
}

export interface IWritableConfig {
  autoTrigger?: boolean;
  triggerAttribute?: string;
  tagNames?: IWritableTagNames;
}

// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

/**
 * Permission state for the Geolocation API, mirroring the Permissions API
 * `PermissionState` plus `"unsupported"` for environments without
 * `navigator.permissions` (or where the `geolocation` permission cannot be
 * queried).
 */
export type GeoPermissionState = "prompt" | "granted" | "denied" | "unsupported";

/**
 * Payload carried by the `wcs-geo:position` event — a structured-clone-friendly
 * snapshot of `GeolocationPosition`. Unlike the live `GeolocationCoordinates`
 * object, every field is a plain value so it can flow through data binding and
 * be serialized.
 *
 * The coordinate fields are intentionally exposed twice: flattened at the top
 * level (so `latitude` / `longitude` bind directly) and nested under `coords`
 * (a `GeolocationPosition`-compatible copy, for consumers that expect the
 * native shape). The two views always hold the same values.
 */
export interface WcsGeoPositionDetail {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
  coords: WcsGeoCoords;
}

export interface WcsGeoCoords {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
}

/**
 * Normalized `GeolocationPositionError`. `code` mirrors the spec constants
 * (PERMISSION_DENIED=1, POSITION_UNAVAILABLE=2, TIMEOUT=3); `unsupported` is
 * surfaced via code 2 with a descriptive message when `navigator.geolocation`
 * is absent.
 */
export interface WcsGeoErrorDetail {
  code: number;
  message: string;
}

/**
 * Options accepted by `getCurrentPosition` / `watch`, mirroring
 * `PositionOptions`.
 */
export interface GeoOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

/**
 * Value types for GeolocationCore (headless) — the observable state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new GeolocationCore();
 * bind(core, (name: keyof WcsGeoCoreValues, value) => { ... });
 * ```
 */
export interface WcsGeoCoreValues {
  position: WcsGeoPositionDetail | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  coords: WcsGeoCoords | null;
  timestamp: number | null;
  watching: boolean;
  loading: boolean;
  error: WcsGeoErrorDetail | null;
  permission: GeoPermissionState;
  /** Last failure's serializable taxonomy (stable code/phase/recoverable), or null. */
  errorInfo: WcsIoErrorInfo | null;
}

/**
 * Value types for the Shell (`<wcs-geo>`) — identical observable surface to the
 * Core, plus the DOM-driven `trigger` command-property.
 */
export interface WcsGeoValues extends WcsGeoCoreValues {
  trigger: boolean;
}

export interface WcsGeoInputs {
  highAccuracy: boolean;
  timeout: number;
  maximumAge: number;
  watch: boolean;
  manual: boolean;
  /**
   * Momentary command-property (no mirrored attribute): a `false`→`true` write
   * requests a single fix, then the flag immediately resets to `false`. Unlike
   * the other inputs it does not reflect to an HTML attribute.
   */
  trigger: boolean;
}

export interface WcsGeoCoreCommands {
  getCurrentPosition(options?: GeoOptions): Promise<void>;
  watch(options?: GeoOptions): void;
  clearWatch(): void;
}

export interface WcsGeoCommands {
  getCurrentPosition(): Promise<void>;
  // Renamed from the Core's `watch` so it does not collide with the `watch`
  // boolean attribute accessor on the Shell (same pattern as <wcs-ws>, where the
  // Core's `send` becomes `sendMessage`).
  watchPosition(): void;
  clearWatch(): void;
}

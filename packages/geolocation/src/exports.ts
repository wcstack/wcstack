export { bootstrapGeolocation } from "./bootstrapGeolocation.js";
export { getConfig } from "./config.js";
export { GeolocationCore } from "./core/GeolocationCore.js";
export { WcsGeolocation } from "./components/Geolocation.js";

export type {
  IWritableConfig, IWritableTagNames, GeoPermissionState, GeoOptions,
  WcsGeoPositionDetail, WcsGeoCoords, WcsGeoErrorDetail,
  WcsGeoCoreValues, WcsGeoValues, WcsGeoInputs, WcsGeoCoreCommands, WcsGeoCommands
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — geolocation's fixes
// don't compete). The generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_GEO_ERROR_CODE } from "./core/geolocationCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-geo")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/geolocation"` or a tsconfig `types` entry).
import type { WcsGeolocation } from "./components/Geolocation.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-geo": WcsGeolocation;
  }
}

export { bootstrapAmbientLightSensor } from "./bootstrapAmbientLightSensor.js";
export { getConfig } from "./config.js";
export { AmbientLightSensorCore } from "./core/AmbientLightSensorCore.js";
export { WcsAmbientLightSensor } from "./components/AmbientLightSensor.js";

export type {
  IWritableConfig, IWritableTagNames, WcsAmbientLightSensorReading, WcsAmbientLightSensorErrorDetail,
  WcsAmbientLightSensorCoreValues, WcsAmbientLightSensorValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — the sensor is a monitor).
// The generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_AMBIENT_LIGHT_SENSOR_ERROR_CODE } from "./core/ambientLightSensorCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-ambient-light-sensor")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/ambient-light-sensor"` or a tsconfig `types` entry).
import type { WcsAmbientLightSensor } from "./components/AmbientLightSensor.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-ambient-light-sensor": WcsAmbientLightSensor;
  }
}

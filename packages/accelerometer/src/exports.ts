export { bootstrapAccelerometer } from "./bootstrapAccelerometer.js";
export { getConfig } from "./config.js";
export { AccelerometerCore } from "./core/AccelerometerCore.js";
export { WcsAccelerometer } from "./components/Accelerometer.js";

export type {
  IWritableConfig, IWritableTagNames, WcsAccelerometerReading, WcsAccelerometerErrorDetail,
  WcsAccelerometerCoreValues, WcsAccelerometerValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — the sensor is a monitor).
// The generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_ACCELEROMETER_ERROR_CODE } from "./core/accelerometerCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-accelerometer")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/accelerometer"` or a tsconfig `types` entry).
import type { WcsAccelerometer } from "./components/Accelerometer.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-accelerometer": WcsAccelerometer;
  }
}

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

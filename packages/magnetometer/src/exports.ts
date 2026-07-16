export { bootstrapMagnetometer } from "./bootstrapMagnetometer.js";
export { getConfig } from "./config.js";
export { MagnetometerCore } from "./core/MagnetometerCore.js";
export { WcsMagnetometer } from "./components/Magnetometer.js";

export type {
  IWritableConfig, IWritableTagNames, WcsMagnetometerReading, WcsMagnetometerErrorDetail,
  WcsMagnetometerCoreValues, WcsMagnetometerValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — the sensor is a monitor).
// The generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_MAGNETOMETER_ERROR_CODE } from "./core/magnetometerCapabilities.js";

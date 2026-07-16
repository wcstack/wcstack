export { bootstrapGyroscope } from "./bootstrapGyroscope.js";
export { getConfig } from "./config.js";
export { GyroscopeCore } from "./core/GyroscopeCore.js";
export { WcsGyroscope } from "./components/Gyroscope.js";

export type {
  IWritableConfig, IWritableTagNames, WcsGyroscopeReading, WcsGyroscopeErrorDetail,
  WcsGyroscopeCoreValues, WcsGyroscopeValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — the sensor is a monitor).
// The generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_GYROSCOPE_ERROR_CODE } from "./core/gyroscopeCapabilities.js";

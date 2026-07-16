export { bootstrapTilt } from "./bootstrapTilt.js";
export { getConfig } from "./config.js";
export { TiltCore } from "./core/TiltCore.js";
export { WcsTilt } from "./components/Tilt.js";

export type {
  IWritableConfig, IWritableTagNames, TiltPermissionState,
  WcsTiltCoreValues, WcsTiltValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — this is a monitor).
// The generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_TILT_ERROR_CODE } from "./core/tiltCapabilities.js";

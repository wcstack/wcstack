export { bootstrapEyedropper } from "./bootstrapEyedropper.js";
export { getConfig } from "./config.js";
export { EyedropperCore } from "./core/EyedropperCore.js";
export { WcsEyedropper } from "./components/Eyedropper.js";

export type {
  IWritableConfig, IWritableTagNames, WcsEyedropperData,
  WcsEyedropperCoreValues, WcsEyedropperValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public. The generic `WcsIoErrorInfo`
// type comes from the shared io-core layer; the eyedropper-specific codes are local.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_EYEDROPPER_ERROR_CODE } from "./core/eyedropperCapabilities.js";

export { bootstrapPip } from "./bootstrapPip.js";
export { getConfig } from "./config.js";
export { PipCore } from "./core/PipCore.js";
export { WcsPip } from "./components/Pip.js";

export type {
  IWritableConfig, IWritableTagNames, WcsPipCoreValues, WcsPipValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property (its value type
// and the stable code constants are public). The generic `WcsIoErrorInfo` type
// comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_PICTURE_IN_PICTURE_ERROR_CODE } from "./core/pictureInPictureCapabilities.js";

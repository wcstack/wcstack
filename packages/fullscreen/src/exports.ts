export { bootstrapFullscreen } from "./bootstrapFullscreen.js";
export { getConfig } from "./config.js";
export { FullscreenCore } from "./core/FullscreenCore.js";
export { WcsFullscreen } from "./components/Fullscreen.js";

export type {
  IWritableConfig, IWritableTagNames, WcsFullscreenCoreValues, WcsFullscreenValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property (its value type
// and the stable code constants are public). The generic `WcsIoErrorInfo` type
// comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_FULLSCREEN_ERROR_CODE } from "./core/fullscreenCapabilities.js";

export { bootstrapShare } from "./bootstrapShare.js";
export { getConfig } from "./config.js";
export { ShareCore } from "./core/ShareCore.js";
export { WcsShare } from "./components/Share.js";

export type {
  IWritableConfig, IWritableTagNames, WcsShareData,
  WcsShareCoreValues, WcsShareValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public. The generic `WcsIoErrorInfo`
// type comes from the shared io-core layer; the share-specific codes are local.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_SHARE_ERROR_CODE } from "./core/shareCapabilities.js";

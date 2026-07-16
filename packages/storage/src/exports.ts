export { bootstrapStorage } from "./bootstrapStorage.js";
export { getConfig } from "./config.js";
export { StorageCore } from "./core/StorageCore.js";
export { Storage as WcsStorage } from "./components/Storage.js";

export type {
  IWritableConfig, IWritableTagNames, WcsStorageError, WcsStorageCoreValues, WcsStorageValues, StorageType
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — storage's load/save/
// remove don't compete). The generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_STORAGE_ERROR_CODE } from "./core/storageCapabilities.js";

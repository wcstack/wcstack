export { bootstrapPointerLock } from "./bootstrapPointerLock.js";
export { getConfig } from "./config.js";
export { PointerLockCore } from "./core/PointerLockCore.js";
export { WcsPointerLock } from "./components/PointerLock.js";

export type {
  IWritableConfig, IWritableTagNames, WcsPointerLockCoreValues, WcsPointerLockValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property (its value type
// and the stable code constants are public). The generic `WcsIoErrorInfo` type
// comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_POINTER_LOCK_ERROR_CODE } from "./core/pointerLockCapabilities.js";

export { bootstrapWakeLock } from "./bootstrapWakeLock.js";
export { getConfig } from "./config.js";
export { WakeLockCore } from "./core/WakeLockCore.js";
export { WcsWakeLock } from "./components/WakeLock.js";

export type {
  IWritableConfig, IWritableTagNames, WakeLockKind,
  WcsWakeLockCoreValues, WcsWakeLockValues, WcsWakeLockInputs,
  WcsWakeLockCoreCommands, WcsWakeLockCommands
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — the wake lock is a pure
// sink). The generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_WAKELOCK_ERROR_CODE } from "./core/wakelockCapabilities.js";

export { bootstrapBroadcast } from "./bootstrapBroadcast.js";
export { getConfig } from "./config.js";
export { BroadcastCore } from "./core/BroadcastCore.js";
export { WcsBroadcast } from "./components/Broadcast.js";

export type {
  IWritableConfig, IWritableTagNames, WcsBroadcastErrorDetail,
  WcsBroadcastCoreValues, WcsBroadcastValues, WcsBroadcastInputs,
  WcsBroadcastCoreCommands, WcsBroadcastCommands
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — post/message are
// concurrent-independent). The generic `WcsIoErrorInfo` type comes from the
// shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_BROADCAST_ERROR_CODE } from "./core/broadcastCapabilities.js";

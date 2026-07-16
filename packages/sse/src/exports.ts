export { bootstrapSse } from "./bootstrapSse.js";
export { getConfig } from "./config.js";
export { SseCore } from "./core/SseCore.js";
export { WcsSse } from "./components/Sse.js";

export type {
  IWritableConfig, IWritableTagNames, SseConnectOptions, WcsSseMessage,
  WcsSseCoreValues, WcsSseValues, WcsSseInputs, WcsSseCoreCommands, WcsSseCommands
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — SSE is a monitor).
// The generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_SSE_ERROR_CODE } from "./core/sseCapabilities.js";

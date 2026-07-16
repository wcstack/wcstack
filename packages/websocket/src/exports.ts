export { bootstrapWebSocket } from "./bootstrapWebSocket.js";
export { getConfig } from "./config.js";
export { WebSocketCore } from "./core/WebSocketCore.js";
export { WcsWebSocket } from "./components/WebSocket.js";

export type {
  IWritableConfig, IWritableTagNames, WcsWsError, WcsWsCoreValues, WcsWsValues,
  WcsWsInputs, WcsWsCoreCommands, WcsWsCommands
} from "./types.js";

export type {
  WebSocketConnectOptions
} from "./core/WebSocketCore.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — WebSocket is a
// persistent session/monitor node). The generic `WcsIoErrorInfo` type comes from
// the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_WEBSOCKET_ERROR_CODE } from "./core/websocketCapabilities.js";

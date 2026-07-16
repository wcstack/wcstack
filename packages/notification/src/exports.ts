export { bootstrapNotification } from "./bootstrapNotification.js";
export { getConfig } from "./config.js";
export { NotificationCore } from "./core/NotificationCore.js";
export { WcsNotify } from "./components/Notify.js";

export type {
  IWritableConfig, IWritableTagNames, PermissionStateOrUnsupported,
  NotificationPermissionRaw, NotifyBackend, NotifyOptions,
  WcsNotifyErrorDetail, WcsNotifyClickDetail, WcsNotifySwMessage,
  WcsNotifyCoreValues, WcsNotifyCoreCommands, WcsNotifyValues, WcsNotifyCommands,
  WcsNotifyInputs
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — show is momentary).
// The generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_NOTIFY_ERROR_CODE } from "./core/notificationCapabilities.js";

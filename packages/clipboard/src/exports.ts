export { bootstrapClipboard } from "./bootstrapClipboard.js";
export { getConfig } from "./config.js";
export { ClipboardCore } from "./core/ClipboardCore.js";
export { WcsClipboard } from "./components/Clipboard.js";

export type {
  IWritableConfig, IWritableTagNames, ClipboardPermissionState,
  WcsClipboardReadItem, WcsClipboardReadDetail, WcsClipboardErrorDetail,
  WcsClipboardCoreValues, WcsClipboardValues, WcsClipboardInputs,
  WcsClipboardCoreCommands, WcsClipboardCommands
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — clipboard's read/write
// don't compete). The generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_CLIPBOARD_ERROR_CODE } from "./core/clipboardCapabilities.js";

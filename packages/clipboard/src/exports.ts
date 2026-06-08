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

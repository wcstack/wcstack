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

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-clipboard")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/clipboard"` or a tsconfig `types` entry).
import type { WcsClipboard } from "./components/Clipboard.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-clipboard": WcsClipboard;
  }
}

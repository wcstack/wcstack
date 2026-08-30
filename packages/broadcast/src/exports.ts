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

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-broadcast")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/broadcast"` or a tsconfig `types` entry).
import type { WcsBroadcast } from "./components/Broadcast.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-broadcast": WcsBroadcast;
  }
}

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

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-sse")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/sse"` or a tsconfig `types` entry).
import type { WcsSse } from "./components/Sse.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-sse": WcsSse;
  }
}

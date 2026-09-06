export { bootstrapIdle } from "./bootstrapIdle.js";
export { getConfig } from "./config.js";
export { IdleCore } from "./core/IdleCore.js";
export { WcsIdle } from "./components/Idle.js";

export type {
  IWritableConfig, IWritableTagNames, IdleUserState, IdleScreenState,
  WcsIdleCoreValues, WcsIdleValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — idle is a single
// command-path node). The generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_IDLE_ERROR_CODE } from "./core/idleCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-idle")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/idle"` or a tsconfig `types` entry).
import type { WcsIdle } from "./components/Idle.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-idle": WcsIdle;
  }
}

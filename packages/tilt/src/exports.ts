export { bootstrapTilt } from "./bootstrapTilt.js";
export { getConfig } from "./config.js";
export { TiltCore } from "./core/TiltCore.js";
export { WcsTilt } from "./components/Tilt.js";

export type {
  IWritableConfig, IWritableTagNames, TiltPermissionState,
  WcsTiltCoreValues, WcsTiltValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — this is a monitor).
// The generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_TILT_ERROR_CODE } from "./core/tiltCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-tilt")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/tilt"` or a tsconfig `types` entry).
import type { WcsTilt } from "./components/Tilt.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-tilt": WcsTilt;
  }
}

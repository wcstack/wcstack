export { bootstrapFullscreen } from "./bootstrapFullscreen.js";
export { getConfig } from "./config.js";
export { FullscreenCore } from "./core/FullscreenCore.js";
export { WcsFullscreen } from "./components/Fullscreen.js";

export type {
  IWritableConfig, IWritableTagNames, WcsFullscreenCoreValues, WcsFullscreenValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property (its value type
// and the stable code constants are public). The generic `WcsIoErrorInfo` type
// comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_FULLSCREEN_ERROR_CODE } from "./core/fullscreenCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-fullscreen")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/fullscreen"` or a tsconfig `types` entry).
import type { WcsFullscreen } from "./components/Fullscreen.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-fullscreen": WcsFullscreen;
  }
}

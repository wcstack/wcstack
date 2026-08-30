export { bootstrapScreenOrientation } from "./bootstrapScreenOrientation.js";
export { getConfig } from "./config.js";
export { ScreenOrientationCore } from "./core/ScreenOrientationCore.js";
export { WcsScreenOrientation } from "./components/ScreenOrientation.js";

export type {
  IWritableConfig, IWritableTagNames, OrientationLockType, WcsScreenOrientationSnapshot,
  WcsScreenOrientationCoreValues, WcsScreenOrientationValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public (no lane — monitoring is a
// synchronous subscribe and lock()/unlock() are a single command path). The
// generic `WcsIoErrorInfo` type comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_SCREEN_ORIENTATION_ERROR_CODE } from "./core/screenOrientationCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-screen-orientation")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/screen-orientation"` or a tsconfig `types` entry).
import type { WcsScreenOrientation } from "./components/ScreenOrientation.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-screen-orientation": WcsScreenOrientation;
  }
}

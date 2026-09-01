export { bootstrapPointerLock } from "./bootstrapPointerLock.js";
export { getConfig } from "./config.js";
export { PointerLockCore } from "./core/PointerLockCore.js";
export { WcsPointerLock } from "./components/PointerLock.js";

export type {
  IWritableConfig, IWritableTagNames, WcsPointerLockCoreValues, WcsPointerLockValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property (its value type
// and the stable code constants are public). The generic `WcsIoErrorInfo` type
// comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_POINTER_LOCK_ERROR_CODE } from "./core/pointerLockCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-pointer-lock")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/pointer-lock"` or a tsconfig `types` entry).
import type { WcsPointerLock } from "./components/PointerLock.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-pointer-lock": WcsPointerLock;
  }
}

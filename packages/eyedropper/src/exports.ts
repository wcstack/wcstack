export { bootstrapEyedropper } from "./bootstrapEyedropper.js";
export { getConfig } from "./config.js";
export { EyedropperCore } from "./core/EyedropperCore.js";
export { WcsEyedropper } from "./components/Eyedropper.js";

export type {
  IWritableConfig, IWritableTagNames, WcsEyedropperData,
  WcsEyedropperCoreValues, WcsEyedropperValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public. The generic `WcsIoErrorInfo`
// type comes from the shared io-core layer; the eyedropper-specific codes are local.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_EYEDROPPER_ERROR_CODE } from "./core/eyedropperCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-eyedropper")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/eyedropper"` or a tsconfig `types` entry).
import type { WcsEyedropper } from "./components/Eyedropper.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-eyedropper": WcsEyedropper;
  }
}

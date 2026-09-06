export { bootstrapPip } from "./bootstrapPip.js";
export { getConfig } from "./config.js";
export { PipCore } from "./core/PipCore.js";
export { WcsPip } from "./components/Pip.js";

export type {
  IWritableConfig, IWritableTagNames, WcsPipCoreValues, WcsPipValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property (its value type
// and the stable code constants are public). The generic `WcsIoErrorInfo` type
// comes from the shared io-core.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_PICTURE_IN_PICTURE_ERROR_CODE } from "./core/pictureInPictureCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-pip")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/picture-in-picture"` or a tsconfig `types` entry).
import type { WcsPip } from "./components/Pip.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-pip": WcsPip;
  }
}

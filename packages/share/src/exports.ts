export { bootstrapShare } from "./bootstrapShare.js";
export { getConfig } from "./config.js";
export { ShareCore } from "./core/ShareCore.js";
export { WcsShare } from "./components/Share.js";

export type {
  IWritableConfig, IWritableTagNames, WcsShareData,
  WcsShareCoreValues, WcsShareValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public. The generic `WcsIoErrorInfo`
// type comes from the shared io-core layer; the share-specific codes are local.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_SHARE_ERROR_CODE } from "./core/shareCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-share")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/share"` or a tsconfig `types` entry).
import type { WcsShare } from "./components/Share.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-share": WcsShare;
  }
}

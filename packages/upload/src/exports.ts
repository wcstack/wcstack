export { bootstrapUpload } from "./bootstrapUpload.js";
export { getConfig } from "./config.js";
export { UploadCore } from "./core/UploadCore.js";
export { WcsUpload } from "./components/Upload.js";
// The helper tag too, so a page that defines the tags itself (an autoloader's wrapper module,
// a scoped registry) can define <wcs-upload-header>, as @wcstack/fetch exports WcsFetchHeader.
export { WcsUploadHeader } from "./components/UploadHeader.js";

export type {
  IWritableConfig, IWritableTagNames, WcsUploadError, WcsUploadCoreValues, WcsUploadValues
} from "./types.js";

export type {
  UploadRequestOptions
} from "./core/UploadCore.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public. The generic `WcsIoErrorInfo`
// type comes from the shared io-core layer; the upload-specific codes are local.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_UPLOAD_ERROR_CODE } from "./core/uploadCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-upload")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/upload"` or a tsconfig `types` entry).
import type { WcsUpload } from "./components/Upload.js";
import type { WcsUploadHeader } from "./components/UploadHeader.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-upload": WcsUpload;
    "wcs-upload-header": WcsUploadHeader;
  }
}

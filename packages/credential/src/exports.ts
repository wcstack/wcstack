export { bootstrapCredential } from "./bootstrapCredential.js";
export { getConfig } from "./config.js";
export { CredentialCore } from "./core/CredentialCore.js";
export { WcsCredential } from "./components/Credential.js";

export type {
  IWritableConfig, IWritableTagNames, CredentialGetOptions, StorableCredential,
  WcsCredentialCoreValues, WcsCredentialValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public. The generic `WcsIoErrorInfo`
// type comes from the shared io-core layer; the credential-specific codes are local.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_CREDENTIAL_ERROR_CODE } from "./core/credentialCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-credential")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/credential"` or a tsconfig `types` entry).
import type { WcsCredential } from "./components/Credential.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-credential": WcsCredential;
  }
}

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

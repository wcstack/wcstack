export { bootstrapContacts } from "./bootstrapContacts.js";
export { getConfig } from "./config.js";
export { ContactsCore } from "./core/ContactsCore.js";
export { WcsContacts } from "./components/Contacts.js";

export type {
  IWritableConfig, IWritableTagNames, ContactProperty, ContactsSelectOptions,
  ContactAddress, ContactInfo, WcsContactsCoreValues, WcsContactsValues,
} from "./types.js";

// Error taxonomy: `errorInfo` is an additive wc-bindable property, so its value
// type and the stable code constants are public. The generic `WcsIoErrorInfo`
// type comes from the shared io-core layer; the contacts-specific codes are local.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_CONTACTS_ERROR_CODE } from "./core/contactsCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-contacts")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/contacts"` or a tsconfig `types` entry).
import type { WcsContacts } from "./components/Contacts.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-contacts": WcsContacts;
  }
}

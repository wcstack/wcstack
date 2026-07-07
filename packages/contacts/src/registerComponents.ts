import { WcsContacts } from "./components/Contacts.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.contacts)) {
    customElements.define(config.tagNames.contacts, WcsContacts);
  }
}

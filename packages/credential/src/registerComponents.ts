import { WcsCredential } from "./components/Credential.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.credential)) {
    customElements.define(config.tagNames.credential, WcsCredential);
  }
}

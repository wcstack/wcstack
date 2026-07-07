import { WcsNetwork } from "./components/Network.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.network)) {
    customElements.define(config.tagNames.network, WcsNetwork);
  }
}

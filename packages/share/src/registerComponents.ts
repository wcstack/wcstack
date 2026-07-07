import { WcsShare } from "./components/Share.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.share)) {
    customElements.define(config.tagNames.share, WcsShare);
  }
}

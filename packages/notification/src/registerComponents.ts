import { WcsNotify } from "./components/Notify.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.notify)) {
    customElements.define(config.tagNames.notify, WcsNotify);
  }
}

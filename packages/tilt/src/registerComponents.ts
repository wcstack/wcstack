import { WcsTilt } from "./components/Tilt.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.tilt)) {
    customElements.define(config.tagNames.tilt, WcsTilt);
  }
}

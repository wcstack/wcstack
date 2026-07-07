import { WcsFullscreen } from "./components/Fullscreen.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.fullscreen)) {
    customElements.define(config.tagNames.fullscreen, WcsFullscreen);
  }
}

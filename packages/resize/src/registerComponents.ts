import { WcsResize } from "./components/Resize.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.resize)) {
    customElements.define(config.tagNames.resize, WcsResize);
  }
}

import { Raf } from "./components/Raf.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.raf)) {
    customElements.define(config.tagNames.raf, Raf);
  }
}

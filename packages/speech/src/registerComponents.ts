import { WcsSpeak } from "./components/Speak.js";
import { WcsListen } from "./components/Listen.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.speak)) {
    customElements.define(config.tagNames.speak, WcsSpeak);
  }
  if (!customElements.get(config.tagNames.listen)) {
    customElements.define(config.tagNames.listen, WcsListen);
  }
}

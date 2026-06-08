import { Debounce } from "./components/Debounce.js";
import { Throttle } from "./components/Throttle.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.debounce)) {
    customElements.define(config.tagNames.debounce, Debounce);
  }
  if (!customElements.get(config.tagNames.throttle)) {
    customElements.define(config.tagNames.throttle, Throttle);
  }
}

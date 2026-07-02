import { WcsIdle } from "./components/Idle.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.idle)) {
    customElements.define(config.tagNames.idle, WcsIdle);
  }
}

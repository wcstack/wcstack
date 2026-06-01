import { Timer } from "./components/Timer.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.timer)) {
    customElements.define(config.tagNames.timer, Timer);
  }
}

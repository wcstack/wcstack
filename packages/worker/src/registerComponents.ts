import { WcsWorker } from "./components/Worker.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.worker)) {
    customElements.define(config.tagNames.worker, WcsWorker);
  }
}

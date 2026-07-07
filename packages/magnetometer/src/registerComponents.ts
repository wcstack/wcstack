import { WcsMagnetometer } from "./components/Magnetometer.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.magnetometer)) {
    customElements.define(config.tagNames.magnetometer, WcsMagnetometer);
  }
}

import { WcsAccelerometer } from "./components/Accelerometer.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.accelerometer)) {
    customElements.define(config.tagNames.accelerometer, WcsAccelerometer);
  }
}

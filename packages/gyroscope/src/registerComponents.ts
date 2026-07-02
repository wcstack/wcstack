import { WcsGyroscope } from "./components/Gyroscope.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.gyroscope)) {
    customElements.define(config.tagNames.gyroscope, WcsGyroscope);
  }
}

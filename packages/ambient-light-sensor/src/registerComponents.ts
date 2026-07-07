import { WcsAmbientLightSensor } from "./components/AmbientLightSensor.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.ambientLightSensor)) {
    customElements.define(config.tagNames.ambientLightSensor, WcsAmbientLightSensor);
  }
}

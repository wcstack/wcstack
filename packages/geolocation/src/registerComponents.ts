import { WcsGeolocation } from "./components/Geolocation.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.geo)) {
    customElements.define(config.tagNames.geo, WcsGeolocation);
  }
}

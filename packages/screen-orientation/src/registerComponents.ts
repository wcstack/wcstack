import { WcsScreenOrientation } from "./components/ScreenOrientation.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.screenOrientation)) {
    customElements.define(config.tagNames.screenOrientation, WcsScreenOrientation);
  }
}

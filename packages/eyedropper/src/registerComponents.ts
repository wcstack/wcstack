import { WcsEyedropper } from "./components/Eyedropper.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.eyedropper)) {
    customElements.define(config.tagNames.eyedropper, WcsEyedropper);
  }
}

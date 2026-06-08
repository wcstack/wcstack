import { WcsIntersect } from "./components/Intersect.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.intersect)) {
    customElements.define(config.tagNames.intersect, WcsIntersect);
  }
}

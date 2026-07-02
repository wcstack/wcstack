import { WcsPointerLock } from "./components/PointerLock.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.pointerLock)) {
    customElements.define(config.tagNames.pointerLock, WcsPointerLock);
  }
}

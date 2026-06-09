import { WcsWakeLock } from "./components/WakeLock.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.wakelock)) {
    customElements.define(config.tagNames.wakelock, WcsWakeLock);
  }
}

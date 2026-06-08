import { WcsBroadcast } from "./components/Broadcast.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.broadcast)) {
    customElements.define(config.tagNames.broadcast, WcsBroadcast);
  }
}

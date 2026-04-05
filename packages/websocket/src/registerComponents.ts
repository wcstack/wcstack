import { WcsWebSocket } from "./components/WebSocket.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.ws)) {
    customElements.define(config.tagNames.ws, WcsWebSocket);
  }
}

import { WcsSse } from "./components/Sse.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.sse)) {
    customElements.define(config.tagNames.sse, WcsSse);
  }
}

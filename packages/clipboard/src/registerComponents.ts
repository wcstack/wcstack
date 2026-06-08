import { WcsClipboard } from "./components/Clipboard.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.clipboard)) {
    customElements.define(config.tagNames.clipboard, WcsClipboard);
  }
}

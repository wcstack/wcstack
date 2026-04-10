import { Storage } from "./components/Storage.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.storage)) {
    customElements.define(config.tagNames.storage, Storage);
  }
}

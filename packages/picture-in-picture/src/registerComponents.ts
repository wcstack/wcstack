import { WcsPip } from "./components/Pip.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.pip)) {
    customElements.define(config.tagNames.pip, WcsPip);
  }
}

import { WcsDefined } from "./components/Defined.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.defined)) {
    customElements.define(config.tagNames.defined, WcsDefined);
  }
}

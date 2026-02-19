import { Autoloader } from "./components/Autoloader.js";
import { config } from "./config.js";

export function registerComponents() {
  if (!customElements.get(config.tagNames.autoloader)) {
    customElements.define(config.tagNames.autoloader, Autoloader);
  }
}

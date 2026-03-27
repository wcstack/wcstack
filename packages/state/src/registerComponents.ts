import { Ssr } from "./components/Ssr";
import { State } from "./components/State";
import { config } from "./config";

export function registerComponents() {
  if (!customElements.get(config.tagNames.ssr)) {
    customElements.define(config.tagNames.ssr, Ssr);
  }
  if (!customElements.get(config.tagNames.state)) {
    customElements.define(config.tagNames.state, State);
  }
}

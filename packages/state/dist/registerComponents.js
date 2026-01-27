import { State } from "./components/State";
import { config } from "./config";
export function registerComponents() {
    // Register custom element
    if (!customElements.get(config.tagNames.state)) {
        customElements.define(config.tagNames.state, State);
    }
}
//# sourceMappingURL=registerComponents.js.map
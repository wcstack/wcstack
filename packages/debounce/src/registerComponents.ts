import { Debounce } from "./components/Debounce.js";
import { Throttle } from "./components/Throttle.js";
import { config } from "./config.js";

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
export function registerComponents(registry: CustomElementRegistry = customElements): void {
  if (!registry.get(config.tagNames.debounce)) {
    registry.define(config.tagNames.debounce, Debounce);
  }
  if (!registry.get(config.tagNames.throttle)) {
    registry.define(config.tagNames.throttle, Throttle);
  }
}

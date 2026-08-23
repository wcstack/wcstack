import { WcsSpeak } from "./components/Speak.js";
import { WcsListen } from "./components/Listen.js";
import { config } from "./config.js";

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
export function registerComponents(registry: CustomElementRegistry = customElements): void {
  if (!registry.get(config.tagNames.speak)) {
    registry.define(config.tagNames.speak, WcsSpeak);
  }
  if (!registry.get(config.tagNames.listen)) {
    registry.define(config.tagNames.listen, WcsListen);
  }
}

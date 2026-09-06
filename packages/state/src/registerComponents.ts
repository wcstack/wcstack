import { Ssr } from "./components/Ssr";
import { State } from "./components/State";
import { config } from "./config";

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
export function registerComponents(registry: CustomElementRegistry = customElements) {
  if (!registry.get(config.tagNames.ssr)) {
    registry.define(config.tagNames.ssr, Ssr);
  }
  if (!registry.get(config.tagNames.state)) {
    registry.define(config.tagNames.state, State);
  }
}

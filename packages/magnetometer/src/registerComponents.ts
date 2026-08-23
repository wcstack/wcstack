import { WcsMagnetometer } from "./components/Magnetometer.js";
import { config } from "./config.js";

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
export function registerComponents(registry: CustomElementRegistry = customElements): void {
  if (!registry.get(config.tagNames.magnetometer)) {
    registry.define(config.tagNames.magnetometer, WcsMagnetometer);
  }
}

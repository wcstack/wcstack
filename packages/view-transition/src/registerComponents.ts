import pkg from "../package.json" with { type: "json" };
import { WcsViewTransition } from "./components/ViewTransition.js";
import { config } from "./config.js";
import { defineElements } from "./protocol/defineElement.js";

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
export function registerComponents(registry: CustomElementRegistry = customElements): void {
  defineElements(registry, `${pkg.name}@${pkg.version}`, [
    [config.tagNames.viewTransition, WcsViewTransition],
  ]);
}

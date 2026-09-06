import { Fetch } from "./components/Fetch.js";
import { FetchHeader } from "./components/FetchHeader.js";
import { FetchBody } from "./components/FetchBody.js";
import { InfiniteScroll } from "./components/InfiniteScroll.js";
import { config } from "./config.js";

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
export function registerComponents(registry: CustomElementRegistry = customElements): void {
  if (!registry.get(config.tagNames.fetch)) {
    registry.define(config.tagNames.fetch, Fetch);
  }
  if (!registry.get(config.tagNames.fetchHeader)) {
    registry.define(config.tagNames.fetchHeader, FetchHeader);
  }
  if (!registry.get(config.tagNames.fetchBody)) {
    registry.define(config.tagNames.fetchBody, FetchBody);
  }
  if (!registry.get(config.tagNames.infiniteScroll)) {
    registry.define(config.tagNames.infiniteScroll, InfiniteScroll);
  }
}

import { Fetch } from "./components/Fetch.js";
import { FetchHeader } from "./components/FetchHeader.js";
import { FetchBody } from "./components/FetchBody.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.fetch)) {
    customElements.define(config.tagNames.fetch, Fetch);
  }
  if (!customElements.get(config.tagNames.fetchHeader)) {
    customElements.define(config.tagNames.fetchHeader, FetchHeader);
  }
  if (!customElements.get(config.tagNames.fetchBody)) {
    customElements.define(config.tagNames.fetchBody, FetchBody);
  }
}

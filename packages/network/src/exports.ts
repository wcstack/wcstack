export { bootstrapNetwork } from "./bootstrapNetwork.js";
export { getConfig } from "./config.js";
export { NetworkCore } from "./core/NetworkCore.js";
export { WcsNetwork } from "./components/Network.js";

export type {
  IWritableConfig, IWritableTagNames, WcsNetworkSnapshot,
  WcsNetworkCoreValues, WcsNetworkValues,
} from "./types.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-network")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/network"` or a tsconfig `types` entry).
import type { WcsNetwork } from "./components/Network.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-network": WcsNetwork;
  }
}

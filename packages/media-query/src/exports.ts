export { bootstrapMediaQuery } from "./bootstrapMediaQuery.js";
export { getConfig } from "./config.js";
export { MediaQueryCore } from "./core/MediaQueryCore.js";
export { WcsMediaQuery } from "./components/MediaQuery.js";

export type {
  IWritableConfig, IWritableTagNames, WcsMediaQuerySnapshot, WcsMediaQueryList,
  WcsMatchMedia, WcsMediaQueryCoreOptions, WcsMediaQueryCoreValues, WcsMediaQueryValues,
} from "./types.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-media-query")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/media-query"` or a tsconfig `types` entry).
import type { WcsMediaQuery } from "./components/MediaQuery.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-media-query": WcsMediaQuery;
  }
}

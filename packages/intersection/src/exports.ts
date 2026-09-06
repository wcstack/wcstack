export { bootstrapIntersection } from "./bootstrapIntersection.js";
export { getConfig } from "./config.js";
export { IntersectionCore } from "./core/IntersectionCore.js";
export { WcsIntersect } from "./components/Intersect.js";

export type {
  IWritableConfig, IWritableTagNames, IntersectOptions,
  WcsIntersectRect, WcsIntersectEntry,
  WcsIntersectCoreValues, WcsIntersectValues, WcsIntersectInputs,
  WcsIntersectCoreCommands, WcsIntersectCommands
} from "./types.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-intersect")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/intersection"` or a tsconfig `types` entry).
import type { WcsIntersect } from "./components/Intersect.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-intersect": WcsIntersect;
  }
}

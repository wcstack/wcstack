export { bootstrapRaf } from "./bootstrapRaf.js";
export { getConfig } from "./config.js";
export { RafCore } from "./core/RafCore.js";
export { Raf as WcsRaf } from "./components/Raf.js";

export type {
  IWritableConfig, IWritableTagNames, WcsRafTickDetail, WcsRafCoreValues, WcsRafValues,
  WcsRafInputs, WcsRafCoreCommands, WcsRafCommands
} from "./types.js";

export type {
  RafStartOptions, RafScheduler
} from "./core/RafCore.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-raf")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/raf"` or a tsconfig `types` entry).
import type { Raf } from "./components/Raf.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-raf": Raf;
  }
}

export { bootstrapDefined } from "./bootstrapDefined.js";
export { getConfig } from "./config.js";
export { DefinedCore } from "./core/DefinedCore.js";
export { WcsDefined } from "./components/Defined.js";

export type {
  IWritableConfig, IWritableTagNames, DefinedMode, DefinedSnapshot,
  WcsDefinedCoreValues, WcsDefinedValues, WcsDefinedInputs
} from "./types.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-defined")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/defined"` or a tsconfig `types` entry).
import type { WcsDefined } from "./components/Defined.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-defined": WcsDefined;
  }
}

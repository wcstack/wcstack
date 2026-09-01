
export { bootstrapState } from "./bootstrapState.js";
export { getConfig } from "./config.js";
export { getBindingsReady } from "./stateElementByName.js";

export { Ssr } from "./components/Ssr.js";
export type { ISsrElement } from "./components/Ssr.js";

export { buildBindings } from "./buildBindings.js";

export { defineState } from "./defineState.js";

export type {
  WcsStateApi, WcsThis,
  WcsPaths, WcsPathValue,
} from "./defineState.js";

export type {
  IWritableConfig, IWritableTagNames
} from "./types.js";

export { VERSION } from "./version.js";

export { getWcsManifest, WCS_MANIFEST_VERSION } from "./manifest.js";
export type { IWcsManifest } from "./manifest.js";

// Phase 5b: opt-in dev-time contract analyzer(既定 off・無効時ゼロコスト)。
export { analyzeContract } from "./contract/contractAnalyzer.js";
export type { IContractManifest } from "./contract/types.js";
export type { ContractEvent } from "./devtools/types.js";
export { builtinFilterMeta } from "./filters/filterMeta.js";
export type { IFilterMeta, FilterResultType, FilterArgType } from "./filters/filterMeta.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-state")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/state"` or a tsconfig `types` entry).
import type { State } from "./components/State.js";
import type { Ssr } from "./components/Ssr.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-state": State;
    "wcs-ssr": Ssr;
  }
}

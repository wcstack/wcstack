export { bootstrapDebounce } from "./bootstrapDebounce.js";
export { getConfig } from "./config.js";
export { DebounceCore } from "./core/DebounceCore.js";
export { makeDebounceProperties } from "./wcBindableFactory.js";
export { Debounce as WcsDebounce } from "./components/Debounce.js";
export { Throttle as WcsThrottle } from "./components/Throttle.js";

export type {
  IWritableConfig, IWritableTagNames, DebounceOptions,
  WcsDebounceSettledDetail, WcsDebounceFiredDetail,
  WcsDebounceCoreValues, WcsDebounceValues, WcsDebounceInputs,
  WcsDebounceCoreCommands, WcsDebounceCommands
} from "./types.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-debounce")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/debounce"` or a tsconfig `types` entry).
import type { Debounce } from "./components/Debounce.js";
import type { Throttle } from "./components/Throttle.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-debounce": Debounce;
    "wcs-throttle": Throttle;
  }
}

export { bootstrapViewTransition } from "./bootstrapViewTransition.js";
export { getConfig } from "./config.js";
export { ViewTransitionCore } from "./core/ViewTransitionCore.js";
export { WcsViewTransition } from "./components/ViewTransition.js";

// transition-runner protocol — the contract @wcstack/router and @wcstack/state
// look up on the global symbol. Exported so an adopter can install its own
// arbiter (or read the installed one) without depending on this element.
export { TRANSITION_RUNNER_KEY, getTransitionRunner, runTransition } from "./protocol/transitionRunner.js";

export type {
  IWritableConfig, IWritableTagNames,
  TransitionMode, ReducedMotionPolicy,
  WcsViewTransitionCoreValues, WcsViewTransitionValues, WcsViewTransitionInputs,
  WcsViewTransitionCoreCommands, WcsViewTransitionCommands
} from "./types.js";

export type {
  IWcsTransitionRunner, IWcsTransitionRunOptions, TransitionNaming, TransitionSource
} from "./protocol/transitionRunner.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-view-transition")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/view-transition"` or a tsconfig `types` entry).
import type { WcsViewTransition } from "./components/ViewTransition.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-view-transition": WcsViewTransition;
  }
}

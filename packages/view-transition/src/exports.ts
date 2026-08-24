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

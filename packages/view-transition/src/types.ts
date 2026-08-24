export interface ITagNames {
  readonly viewTransition: string;
}

export interface IWritableTagNames {
  viewTransition?: string;
}

export interface IConfig {
  readonly tagNames: ITagNames;
}

export interface IWritableConfig {
  tagNames?: IWritableTagNames;
}

// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

// transition-runner protocol — single source of truth in /protocol/transition-runner.ts.
export type {
  IWcsTransitionRunner, IWcsTransitionRunOptions, TransitionNaming, TransitionSource,
} from "./protocol/transitionRunner.js";

/**
 * What happens when a transition request arrives while one is already running.
 * The vocabulary is the exclusion vocabulary of docs/async-execution-model.md,
 * reused rather than reinvented.
 *
 *   "latest"  — skip the running transition and animate the newcomer (default).
 *   "queue"   — chain: the newcomer starts once the running one has finished.
 *   "exhaust" — apply the newcomer's mutation immediately, without animating it.
 *
 * In every mode the mutation is applied exactly once. `exhaust` drops the
 * *animation*, never the DOM update.
 */
export type TransitionMode = "latest" | "queue" | "exhaust";

/** Whether `prefers-reduced-motion: reduce` suppresses transitions. */
export type ReducedMotionPolicy = "skip" | "animate";

/**
 * Value types for ViewTransitionCore (headless) — the observable state properties.
 */
export interface WcsViewTransitionCoreValues {
  /** Whether a view transition is running right now. */
  active: boolean;
  /** The last failure to start a transition, or `null` while none. */
  error: Error | null;
}

/** Value types for the Shell (`<wcs-view-transition>`) — identical to the Core. */
export type WcsViewTransitionValues = WcsViewTransitionCoreValues;

export interface WcsViewTransitionInputs {
  /** Inert arbiter: every request applies synchronously, without a transition. */
  disabled: boolean;
  /** Exclusion policy. */
  mode: TransitionMode;
  /** `view-transition-name` assignment policy handed to participants. */
  naming: import("./protocol/transitionRunner.js").TransitionNaming;
  /** Upper bound on auto-assigned names. */
  namingLimit: number;
  /** `prefers-reduced-motion` policy. */
  reducedMotion: ReducedMotionPolicy;
  /** Transition types, where `startViewTransition({ types })` is supported. */
  types: readonly string[];
  /** Participants allowed to animate (`router`, `state`). */
  participants: readonly string[];
}

export interface WcsViewTransitionCoreCommands {
  /**
   * Finish the running transition immediately. The DOM update is never skipped —
   * only the animation is. A no-op when nothing is running.
   */
  skip(): void;
}

export type WcsViewTransitionCommands = WcsViewTransitionCoreCommands;

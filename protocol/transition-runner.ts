// transition-runner protocol — how a package that mutates the DOM hands that
// mutation to whoever is arbitrating view transitions on the page.
//
// @wcstack/state and @wcstack/router must not depend on @wcstack/view-transition
// (zero runtime dependencies, independently publishable), so the arbiter installs
// itself on a well-known global symbol and the participants look it up lazily.
// No arbiter installed means the mutation is invoked directly, synchronously —
// byte-for-byte the behavior these packages had before the protocol existed.
//
// docs/view-transition-design.md §4 is the normative description.
//
// SINGLE SOURCE OF TRUTH: edit only this file (/protocol/transition-runner.ts), then run
// `node scripts/sync-protocol-types.mjs` to regenerate the per-package copies
// (packages/<pkg>/src/protocol/transitionRunner.ts). Those copies are generated — do not edit them.

/**
 * Global key the arbiter installs itself under. `Symbol.for` so independently
 * loaded copies of this file (two CDN bundles on one page) still agree.
 */
export const TRANSITION_RUNNER_KEY = Symbol.for("wcstack.transition-runner");

/** Who is asking. Backs the arbiter's `for=` participant gate. */
export type TransitionSource = "router" | "state";

/** `view-transition-name` assignment policy the arbiter declares for participants. */
export type TransitionNaming = "manual" | "auto";

export interface IWcsTransitionRunOptions {
  /** Participant id, for the `for=` gate and for diagnostics. */
  readonly source?: string;
  /** Transition types, where the environment supports `startViewTransition({ types })`. */
  readonly types?: readonly string[];
}

export interface IWcsTransitionRunner {
  readonly protocol: "wcs-transition-runner";
  /** Integer protocol version. All versions >= 1 are participant-compatible. */
  readonly version: number;
  /** `"auto"` licenses a participant to assign `view-transition-name` itself. */
  readonly naming: TransitionNaming;
  /** Upper bound on auto-assigned names; past it a participant stops naming. */
  readonly namingLimit: number;
  /** Whether this participant animates at all. */
  accepts(source: string): boolean;
  /**
   * Invoke `mutate` inside a view transition when one is possible.
   *
   * Contract (docs/view-transition-design.md §4):
   *   - `mutate` is invoked exactly once, whatever happens to the transition.
   *   - The promise resolves once `mutate` has run — never waits for the animation.
   *   - When no transition is started, `mutate` runs synchronously inside `run()`.
   *   - It rejects only if `mutate` threw.
   */
  run(mutate: () => void, options?: IWcsTransitionRunOptions): Promise<void>;
}

/**
 * The installed arbiter, or null when there is none, it speaks a version this
 * reader does not, or it does not accept this participant.
 *
 * Looked up on every call rather than cached: the tag can be added, removed, or
 * reconfigured at any point in a page's life, and a stale cache would either
 * animate what the author just switched off or miss what they switched on.
 */
export function getTransitionRunner(source: string): IWcsTransitionRunner | null {
  const candidate = (globalThis as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY] as
    | IWcsTransitionRunner
    | undefined;
  if (candidate === undefined || candidate === null) return null;
  if (candidate.protocol !== "wcs-transition-runner") return null;
  if (typeof candidate.version !== "number" || candidate.version < 1) return null;
  if (typeof candidate.run !== "function") return null;
  if (typeof candidate.accepts !== "function" || !candidate.accepts(source)) return null;
  return candidate;
}

/**
 * Run `mutate` under the installed arbiter, or directly when there is none.
 *
 * Returns `undefined` in the no-arbiter case instead of a resolved promise: the
 * state drain calls this on every batch, and awaiting is a caller's choice, not
 * an allocation the common path should pay for. `await` accepts both.
 */
export function runTransition(
  source: string,
  mutate: () => void,
  types?: readonly string[],
): Promise<void> | undefined {
  const runner = getTransitionRunner(source);
  if (runner === null) {
    mutate();
    return undefined;
  }
  return runner.run(mutate, { source, types });
}

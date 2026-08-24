import { IWcBindable, ReducedMotionPolicy, TransitionMode } from "../types.js";
import {
  IWcsTransitionRunOptions,
  IWcsTransitionRunner,
  TRANSITION_RUNNER_KEY,
  TransitionNaming,
} from "../protocol/transitionRunner.js";

/**
 * Minimal structural views of the View Transition API. Declared locally rather
 * than relying on `lib.dom`'s (still moving) definitions, so the package
 * type-checks identically across TypeScript lib versions and an environment
 * without the API is a value check, never a type error.
 */
interface IViewTransitionLike {
  readonly updateCallbackDone: Promise<void>;
  readonly finished: Promise<void>;
  readonly ready: Promise<void>;
  skipTransition(): void;
}

interface IStartViewTransitionOptions {
  update: () => void;
  types?: string[];
}

type StartViewTransition = (
  callbackOrOptions: (() => void) | IStartViewTransitionOptions,
) => IViewTransitionLike;

interface IPendingEntry {
  readonly mutate: () => void;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
}

const DEFAULT_NAMING_LIMIT = 200;
const DEFAULT_PARTICIPANTS: readonly string[] = ["router", "state"];

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function prefersReducedMotion(): boolean {
  // never-throw: matchMedia is absent in happy-dom and in non-browser hosts.
  try {
    const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
    if (typeof mm !== "function") return false;
    return mm.call(globalThis, "(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

/**
 * Whether `startViewTransition({ update, types })` is understood. Detected on
 * `ViewTransition.prototype`, because passing the object form to an
 * implementation that only accepts a callback would throw at the call site —
 * after the browser has already decided it has no update callback to run.
 */
function supportsTypes(): boolean {
  try {
    const ctor = (globalThis as { ViewTransition?: { prototype: object } }).ViewTransition;
    return ctor !== undefined && "types" in ctor.prototype;
  } catch {
    return false;
  }
}

/**
 * Headless view-transition arbiter — the single place on a page that decides
 * whether a DOM mutation animates, and what happens when two of them collide.
 *
 * It is not an I/O node: nothing is read from a device and there is no data to
 * bind. It is a *policy* node. Participants (`@wcstack/router`, `@wcstack/state`)
 * never import it; they find it through the transition-runner protocol on a
 * well-known global symbol and hand it a mutation to run
 * (docs/view-transition-design.md §4).
 *
 * The one invariant everything else is subordinate to: **a mutation handed to
 * `run()` is applied exactly once**, whatever is decided about animating it. An
 * unsupported browser, a hidden tab, reduced motion, a colliding transition and a
 * `startViewTransition` that throws all end in the mutation running — the page
 * must never be left showing stale DOM because an animation could not be played.
 */
export class ViewTransitionCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "active", event: "wcs-view-transition:active-changed", semantics: "state" },
      { name: "error", event: "wcs-view-transition:error", semantics: "state" },
    ],
    commands: [
      { name: "skip" },
    ],
  };

  private _target: EventTarget;

  private _mode: TransitionMode = "latest";
  private _naming: TransitionNaming = "manual";
  private _namingLimit: number = DEFAULT_NAMING_LIMIT;
  private _reducedMotion: ReducedMotionPolicy = "skip";
  private _types: string[] = [];
  private _disabled: boolean = false;
  private _participants: Set<string> = new Set(DEFAULT_PARTICIPANTS);

  private _active: boolean = false;
  private _error: Error | null = null;

  /** Requests waiting for the microtask flush that starts a transition. */
  private _pending: IPendingEntry[] | null = null;
  private _flushScheduled: boolean = false;
  /**
   * The batch handed to the running transition while its update callback has not
   * fired yet. Non-null means "capturing": a request arriving now still joins this
   * batch, which is both the coalescing window and the only ordering guarantee
   * that keeps a later `exhaust`/`latest` request from applying ahead of it.
   */
  private _batch: IPendingEntry[] | null = null;
  private _transition: IViewTransitionLike | null = null;
  private _queue: IPendingEntry[][] = [];

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  // --- transition-runner protocol surface ---

  get protocol(): "wcs-transition-runner" {
    return "wcs-transition-runner";
  }

  get version(): number {
    return 1;
  }

  get naming(): TransitionNaming {
    return this._naming;
  }

  set naming(value: TransitionNaming) {
    this._naming = value === "auto" ? "auto" : "manual";
  }

  get namingLimit(): number {
    return this._namingLimit;
  }

  set namingLimit(value: number) {
    this._namingLimit = Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_NAMING_LIMIT;
  }

  accepts(source: string): boolean {
    return this._participants.has(source);
  }

  /**
   * Install this core as the page's arbiter. Returns false (and warns) when
   * another one already holds the slot — two arbiters would each think they own
   * the exclusion, which is precisely the thing an arbiter exists to prevent.
   */
  install(): boolean {
    const slot = globalThis as Record<symbol, unknown>;
    const current = slot[TRANSITION_RUNNER_KEY];
    if (current !== undefined && current !== null && current !== this) {
      console.warn(
        "[@wcstack/view-transition] a transition runner is already installed; " +
        "this element is inert. Use one <wcs-view-transition> per document.",
      );
      return false;
    }
    slot[TRANSITION_RUNNER_KEY] = this as unknown as IWcsTransitionRunner;
    return true;
  }

  /** Release the arbiter slot, but only if it is still ours. */
  uninstall(): void {
    const slot = globalThis as Record<symbol, unknown>;
    if (slot[TRANSITION_RUNNER_KEY] === (this as unknown)) {
      delete slot[TRANSITION_RUNNER_KEY];
    }
  }

  // --- configuration ---

  get mode(): TransitionMode {
    return this._mode;
  }

  set mode(value: TransitionMode) {
    this._mode = value === "queue" || value === "exhaust" ? value : "latest";
  }

  get reducedMotion(): ReducedMotionPolicy {
    return this._reducedMotion;
  }

  set reducedMotion(value: ReducedMotionPolicy) {
    this._reducedMotion = value === "animate" ? "animate" : "skip";
  }

  get types(): readonly string[] {
    return this._types;
  }

  set types(value: readonly string[]) {
    this._types = value.slice();
  }

  get disabled(): boolean {
    return this._disabled;
  }

  set disabled(value: boolean) {
    this._disabled = value === true;
  }

  get participants(): readonly string[] {
    return [...this._participants];
  }

  set participants(value: readonly string[]) {
    this._participants = new Set(value.length > 0 ? value : DEFAULT_PARTICIPANTS);
  }

  // --- observable outputs ---

  get active(): boolean {
    return this._active;
  }

  get error(): Error | null {
    return this._error;
  }

  // --- commands ---

  /**
   * Finish the running transition now. Per spec the update callback still runs if
   * it has not yet, so skipping loses the animation and never the DOM update.
   */
  skip(): void {
    this._transition?.skipTransition();
  }

  // --- the protocol entry point ---

  run(mutate: () => void, _options?: IWcsTransitionRunOptions): Promise<void> {
    if (!this._canTransition()) {
      return this._applyNow(mutate);
    }
    return new Promise<void>((resolve, reject) => {
      const entry: IPendingEntry = { mutate, resolve, reject };
      // Capturing: the running transition has not called its update callback yet,
      // so this mutation can still ride along — and must, or it would be applied
      // before mutations that were requested earlier.
      if (this._batch !== null) {
        this._batch.push(entry);
        return;
      }
      if (this._transition !== null && this._mode === "exhaust") {
        this._settle(entry);
        return;
      }
      (this._pending ??= []).push(entry);
      this._schedule();
    });
  }

  dispose(): void {
    this.uninstall();
    // Anything still queued belongs to a page that is going away; apply it so the
    // DOM does not stay behind the state that asked for the change.
    const abandoned = [...(this._pending ?? []), ...this._queue.flat()];
    this._pending = null;
    this._queue = [];
    for (const entry of abandoned) {
      this._settle(entry);
    }
  }

  // --- internals ---

  private _canTransition(): boolean {
    if (this._disabled) return false;
    const doc = (globalThis as { document?: Document }).document;
    if (doc === undefined || typeof (doc as { startViewTransition?: unknown }).startViewTransition !== "function") {
      return false;
    }
    // A hidden tab gets no rendering opportunities, so the update callback would
    // not run until the page is looked at again — the DOM would silently freeze
    // for as long as the tab stays in the background. Apply straight through.
    if (doc.hidden === true) return false;
    if (this._reducedMotion === "skip" && prefersReducedMotion()) return false;
    return true;
  }

  private _applyNow(mutate: () => void): Promise<void> {
    try {
      mutate();
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve();
  }

  private _settle(entry: IPendingEntry): void {
    try {
      entry.mutate();
      entry.resolve();
    } catch (error) {
      entry.reject(error);
    }
  }

  private _schedule(): void {
    if (this._flushScheduled) return;
    this._flushScheduled = true;
    queueMicrotask(() => this._flush());
  }

  private _flush(): void {
    this._flushScheduled = false;
    const batch = this._pending;
    this._pending = null;
    if (batch === null || batch.length === 0) return;
    if (this._transition !== null) {
      if (this._mode === "queue") {
        this._queue.push(batch);
        return;
      }
      if (this._mode === "exhaust") {
        for (const entry of batch) {
          this._settle(entry);
        }
        return;
      }
      // "latest": starting a new transition skips the running one, and the
      // running one is past its update callback (a capturing batch is joined in
      // run(), never reaching here), so ordering holds.
    }
    this._start(batch);
  }

  private _start(batch: IPendingEntry[]): void {
    const doc = (globalThis as unknown as { document: Document }).document;
    const start = (doc as unknown as { startViewTransition: StartViewTransition }).startViewTransition;
    this._batch = batch;
    const update = (): void => {
      const running = this._batch;
      this._batch = null;
      if (running === null) return;
      for (const entry of running) {
        this._settle(entry);
      }
    };
    let transition: IViewTransitionLike;
    try {
      transition = this._types.length > 0 && supportsTypes()
        ? start.call(doc, { update, types: [...this._types] })
        : start.call(doc, update);
    } catch (error) {
      // Could not even start: apply the mutations rather than lose them.
      this._batch = null;
      this._setError(toError(error));
      for (const entry of batch) {
        this._settle(entry);
      }
      return;
    }
    this._transition = transition;
    this._setError(null);
    this._setActive(true);
    // `finished` rejects when the update callback throws — it cannot here, since
    // _settle catches per entry — and `ready` rejects whenever the transition is
    // skipped, which is routine. Both are attached defensively so a routine skip
    // never surfaces as an unhandled rejection.
    const done = (): void => this._onFinished(transition);
    transition.finished.then(done, done);
    transition.ready.then(undefined, () => { /* skipped: not an error */ });
    transition.updateCallbackDone.then(undefined, () => { /* settled per entry */ });
  }

  private _onFinished(transition: IViewTransitionLike): void {
    // A superseded transition ("latest") still settles; only the current one owns
    // the active flag and the queue.
    if (this._transition !== transition) return;
    this._transition = null;
    this._setActive(false);
    const next = this._queue.shift();
    if (next !== undefined) {
      this._start(next);
    }
  }

  private _setActive(value: boolean): void {
    if (this._active === value) return;
    this._active = value;
    this._dispatch("wcs-view-transition:active-changed", value);
  }

  private _setError(error: Error | null): void {
    if (this._error === error) return;
    this._error = error;
    this._dispatch("wcs-view-transition:error", error);
  }

  private _dispatch(type: string, detail: unknown): void {
    this._target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

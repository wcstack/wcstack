/**
 * Global key the arbiter installs itself under. `Symbol.for` so independently
 * loaded copies of this file (two CDN bundles on one page) still agree.
 */
declare const TRANSITION_RUNNER_KEY: unique symbol;
/** Who is asking. Backs the arbiter's `for=` participant gate. */
type TransitionSource = "router" | "state";
/** `view-transition-name` assignment policy the arbiter declares for participants. */
type TransitionNaming = "manual" | "auto";
interface IWcsTransitionRunOptions {
    /** Participant id, for the `for=` gate and for diagnostics. */
    readonly source?: string;
    /** Transition types, where the environment supports `startViewTransition({ types })`. */
    readonly types?: readonly string[];
}
interface IWcsTransitionRunner {
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
declare function getTransitionRunner(source: string): IWcsTransitionRunner | null;
/**
 * Run `mutate` under the installed arbiter, or directly when there is none.
 *
 * Returns `undefined` in the no-arbiter case instead of a resolved promise: the
 * state drain calls this on every batch, and awaiting is a caller's choice, not
 * an allocation the common path should pay for. `await` accepts both.
 */
declare function runTransition(source: string, mutate: () => void, types?: readonly string[]): Promise<void> | undefined;

/**
 * Observation semantics of a `properties` entry.
 *
 *   "state"  — current value. A snapshot may cache it, and equality-based dedupe is safe.
 *   "event"  — occurrence. Repeated identical payloads are distinct occurrences; never dedupe.
 *   "handle" — live / opaque resource with its own lifecycle (e.g. MediaStream). Not
 *              snapshot-safe and not necessarily serializable; consumers need an explicit
 *              ref / callback surface rather than a value slot.
 */
type WcBindableSemantics = "state" | "event" | "handle";
interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
    /**
     * Optional, additive, forward-compatible. An absent value means **unspecified**, NOT
     * "state": a reader that finds no `semantics` MUST keep the behavior it had before this
     * field existed (deliver the update as-is; do not start deduping, caching or serializing
     * on assumption). Only an explicit value licenses a reader to change its handling.
     */
    readonly semantics?: WcBindableSemantics;
}
interface IWcBindableInput {
    readonly name: string;
    readonly attribute?: string;
}
interface IWcBindableCommand {
    readonly name: string;
    readonly async?: boolean;
}
interface IWcBindable {
    readonly protocol: "wc-bindable";
    /** Integer protocol version. All versions >= 1 are core-compatible. */
    readonly version: number;
    readonly properties: readonly IWcBindableProperty[];
    readonly inputs?: readonly IWcBindableInput[];
    readonly commands?: readonly IWcBindableCommand[];
}

interface ITagNames {
    readonly viewTransition: string;
}
interface IWritableTagNames {
    viewTransition?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

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
type TransitionMode = "latest" | "queue" | "exhaust";
/** Whether `prefers-reduced-motion: reduce` suppresses transitions. */
type ReducedMotionPolicy = "skip" | "animate";
/**
 * Value types for ViewTransitionCore (headless) — the observable state properties.
 */
interface WcsViewTransitionCoreValues {
    /** Whether a view transition is running right now. */
    active: boolean;
    /** The last failure to start a transition, or `null` while none. */
    error: Error | null;
}
/** Value types for the Shell (`<wcs-view-transition>`) — identical to the Core. */
type WcsViewTransitionValues = WcsViewTransitionCoreValues;
interface WcsViewTransitionInputs {
    /** Inert arbiter: every request applies synchronously, without a transition. */
    disabled: boolean;
    /** Exclusion policy. */
    mode: TransitionMode;
    /** `view-transition-name` assignment policy handed to participants. */
    naming: TransitionNaming;
    /** Upper bound on auto-assigned names. */
    namingLimit: number;
    /** `prefers-reduced-motion` policy. */
    reducedMotion: ReducedMotionPolicy;
    /** Transition types, where `startViewTransition({ types })` is supported. */
    types: readonly string[];
    /** Participants allowed to animate (`router`, `state`). */
    participants: readonly string[];
}
interface WcsViewTransitionCoreCommands {
    /**
     * Finish the running transition immediately. The DOM update is never skipped —
     * only the animation is. A no-op when nothing is running.
     */
    skip(): void;
}
type WcsViewTransitionCommands = WcsViewTransitionCoreCommands;

declare function bootstrapViewTransition(userConfig?: IWritableConfig, registry?: CustomElementRegistry): void;

declare function getConfig(): IConfig;

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
declare class ViewTransitionCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _mode;
    private _naming;
    private _namingLimit;
    private _reducedMotion;
    private _types;
    private _disabled;
    private _participants;
    private _active;
    private _error;
    /** Requests waiting for the microtask flush that starts a transition. */
    private _pending;
    private _flushScheduled;
    /**
     * The batch handed to the running transition while its update callback has not
     * fired yet. Non-null means "capturing": a request arriving now still joins this
     * batch, which is both the coalescing window and the only ordering guarantee
     * that keeps a later `exhaust`/`latest` request from applying ahead of it.
     */
    private _batch;
    private _transition;
    private _queue;
    constructor(target?: EventTarget);
    get protocol(): "wcs-transition-runner";
    get version(): number;
    get naming(): TransitionNaming;
    set naming(value: TransitionNaming);
    get namingLimit(): number;
    set namingLimit(value: number);
    accepts(source: string): boolean;
    /**
     * Install this core as the page's arbiter. Returns false (and warns) when
     * another one already holds the slot — two arbiters would each think they own
     * the exclusion, which is precisely the thing an arbiter exists to prevent.
     */
    install(): boolean;
    /** Release the arbiter slot, but only if it is still ours. */
    uninstall(): void;
    get mode(): TransitionMode;
    set mode(value: TransitionMode);
    get reducedMotion(): ReducedMotionPolicy;
    set reducedMotion(value: ReducedMotionPolicy);
    get types(): readonly string[];
    set types(value: readonly string[] | string);
    get disabled(): boolean;
    set disabled(value: boolean);
    get participants(): readonly string[];
    set participants(value: readonly string[] | string);
    get active(): boolean;
    get error(): Error | null;
    /**
     * Finish the running transition now. Per spec the update callback still runs if
     * it has not yet, so skipping loses the animation and never the DOM update.
     */
    skip(): void;
    run(mutate: () => void, _options?: IWcsTransitionRunOptions): Promise<void>;
    dispose(): void;
    private _canTransition;
    private _applyNow;
    private _settle;
    private _schedule;
    private _flush;
    private _start;
    private _onFinished;
    private _setActive;
    private _setError;
    private _dispatch;
}

/**
 * `<wcs-view-transition>` — the page's view-transition policy node.
 *
 * It renders nothing and binds no data. It declares *how* the DOM changes that
 * `@wcstack/router` and `@wcstack/state` make should animate, and it is the single
 * arbiter that decides what happens when two of those changes collide. Dropping
 * the tag on a page is the opt-in; removing it restores the framework's original
 * synchronous behavior exactly (docs/view-transition-design.md §3, G1/G2).
 *
 * ```html
 * <wcs-view-transition for="router" mode="latest"></wcs-view-transition>
 * ```
 *
 * The animation itself is written in CSS against `::view-transition-*`. This tag
 * starts and arbitrates transitions; it never describes one.
 */
declare class WcsViewTransition extends HTMLElement {
    static observedAttributes: string[];
    static wcBindable: IWcBindable;
    private _core;
    private _internals;
    private _installed;
    constructor();
    /** The headless arbiter, for direct (non-DOM) use. */
    get core(): ViewTransitionCore;
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get disabled(): boolean;
    set disabled(value: boolean);
    get mode(): TransitionMode;
    set mode(value: TransitionMode);
    get naming(): TransitionNaming;
    set naming(value: TransitionNaming);
    get namingLimit(): number;
    set namingLimit(value: number);
    get reducedMotion(): ReducedMotionPolicy;
    set reducedMotion(value: ReducedMotionPolicy);
    get types(): readonly string[];
    set types(value: readonly string[] | string);
    get participants(): readonly string[];
    set participants(value: readonly string[] | string);
    get active(): boolean;
    get error(): Error | null;
    skip(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void;
    /**
     * Apply the attributes present at connect time. Absent ones are deliberately
     * skipped rather than applied as null: a property assigned before upgrade
     * (Angular's `[prop]`, Lit's `.prop=`, or plain `el.mode = ...`) has just been
     * replayed through the setter by `upgradeProperties`, and re-applying a missing
     * attribute would immediately reset it to the default. Removing an attribute
     * still resets, via `attributeChangedCallback`.
     */
    private _syncAllAttributes;
    private _applyAttribute;
}

export { TRANSITION_RUNNER_KEY, ViewTransitionCore, WcsViewTransition, bootstrapViewTransition, getConfig, getTransitionRunner, runTransition };
export type { IWcsTransitionRunOptions, IWcsTransitionRunner, IWritableConfig, IWritableTagNames, ReducedMotionPolicy, TransitionMode, TransitionNaming, TransitionSource, WcsViewTransitionCommands, WcsViewTransitionCoreCommands, WcsViewTransitionCoreValues, WcsViewTransitionInputs, WcsViewTransitionValues };

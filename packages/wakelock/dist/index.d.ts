interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
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
    readonly version: 1;
    readonly properties: readonly IWcBindableProperty[];
    readonly inputs?: readonly IWcBindableInput[];
    readonly commands?: readonly IWcBindableCommand[];
}

interface ITagNames {
    readonly wakelock: string;
}
interface IWritableTagNames {
    wakelock?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * Wake lock type. The spec currently standardizes only `"screen"`; the field
 * exists for forward compatibility with future lock types.
 */
type WakeLockKind = "screen";
/**
 * Value types for WakeLockCore (headless) — the observable state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 *
 * Unlike the @wcstack sensor tags (geolocation / intersection), the wake lock is
 * a pure *sink*: a bound state drives whether the lock is held (`active`, an
 * input), and the only outputs are `held` — whether a sentinel is actually held
 * right now — and `error`. `active` (the desired intent) is deliberately not an
 * observable output: it does not change when the OS auto-releases the lock, only
 * `held` does.
 *
 * @example
 * ```typescript
 * const core = new WakeLockCore();
 * bind(core, (name: keyof WcsWakeLockCoreValues, value) => { ... });
 * await core.request();
 * ```
 */
interface WcsWakeLockCoreValues {
    /** Whether a wake lock sentinel is currently held (actual state). */
    held: boolean;
    /** The last request failure, or `null` while none. */
    error: Error | null;
}
/**
 * Value types for the Shell (`<wcs-wakelock>`) — identical observable surface to
 * the Core (`held` / `error`).
 */
type WcsWakeLockValues = WcsWakeLockCoreValues;
interface WcsWakeLockInputs {
    /**
     * Desired intent: hold the screen awake while `true`. The headline declarative
     * binding (`active@isPlaying`). Mirrored to the `active` boolean attribute.
     * Setting it `false` releases the lock. It stays `true` across an OS auto-release
     * (tab hidden) so the lock is re-acquired when the page becomes visible again —
     * read `held` for the actual current state.
     */
    active: boolean;
    /** Lock type. Only `"screen"` is standardized; defaults to `"screen"`. */
    type: WakeLockKind;
    /** Do not auto-acquire on connect even if `active` is present; drive via commands. */
    manual: boolean;
}
interface WcsWakeLockCoreCommands {
    /**
     * Mark the lock as desired and acquire it (if the page is visible and the API
     * is supported). Never rejects — a failure surfaces via the `error` property.
     */
    request(): Promise<void>;
    /** Mark the lock as no longer desired and release any held sentinel. */
    release(): void;
}
interface WcsWakeLockCommands {
    request(): Promise<void>;
    release(): void;
}

declare function bootstrapWakeLock(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless screen-wake-lock primitive — a thin, framework-agnostic wrapper around
 * the Screen Wake Lock API exposed through the wc-bindable protocol.
 *
 * Unlike the other @wcstack sensors (geolocation / intersection), the wake lock is
 * a pure *sink*: nothing is read from the device. A bound state drives the desired
 * intent (`request()` / `release()`), and the only observable outputs are `held`
 * (whether a sentinel is actually held) and `error`.
 *
 * The OS releases the lock whenever the page stops being visible (tab hidden,
 * window minimized). To honor the declarative intent ("keep awake *while* active"),
 * the Core keeps the desired flag (`_active`) and re-acquires the lock on the next
 * `visibilitychange` back to visible. So `_active` (desired) and `held` (actual)
 * diverge across an auto-release — and only `held` is published, because desired
 * does not change when the OS drops the lock.
 *
 * Never-throw: `request()` never rejects (a failure surfaces via `error`), and an
 * unsupported environment is a silent no-op (`held` stays false), consistent with
 * the other @wcstack sensors.
 */
declare class WakeLockCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _type;
    private _active;
    private _held;
    private _error;
    private _sentinel;
    private _gen;
    private _acquiring;
    private _visibilityBound;
    private _ready;
    constructor(target?: EventTarget, type?: WakeLockKind);
    get ready(): Promise<void>;
    observe(): Promise<void>;
    get held(): boolean;
    get error(): Error | null;
    /** The desired intent. Read-only reflection; not a wc-bindable property (it does
     * not change on an OS auto-release, so there is nothing to observe). */
    get active(): boolean;
    get type(): WakeLockKind;
    set type(value: WakeLockKind);
    private _setHeld;
    private _setError;
    private _sameError;
    /**
     * Mark the lock as desired and acquire it. Idempotent while already held. If the
     * API is unavailable or the page is currently hidden, the desired flag is still
     * set (so the lock is acquired on the next return to visibility) but nothing is
     * acquired now. Never rejects — a request failure surfaces via `error`.
     */
    request(): Promise<void>;
    /** Mark the lock as no longer desired and release any held sentinel. */
    release(): void;
    /**
     * Full teardown: remove the visibility listener and release any held sentinel.
     * Call from the Shell's `disconnectedCallback`.
     *
     * Semantics: this is a terminal teardown, not a pause. After `dispose()` the Core
     * is meant to be discarded — there is no re-arm step, and the visibility listener
     * is gone, so an OS auto-release will no longer be followed by a re-acquire. A
     * later `request()` would still work in isolation (it re-attaches the listener via
     * `_ensureVisibilityListener`), but reusing a disposed Core is not an intended path;
     * the Shell always constructs a fresh Core per element instead.
     */
    dispose(): void;
    private _acquire;
    /**
     * Re-attempt an acquire after an in-flight one was *superseded* (its generation no
     * longer matches), but only if the lock is still desired, not already held, and the
     * page is visible. This recovers a request() that was coalesced away by the
     * in-flight `_acquiring` guard: during a release()→request() overlap, the second
     * request() bumps `_gen` and is a no-op at the guard, so without this retry its
     * still-live intent would be lost until the next visibilitychange or manual call.
     *
     * Bounded — cannot loop forever: a retry runs ONLY on supersession, and a
     * supersession requires an external release()/request() to bump `_gen` mid-flight.
     * A retry's own `_acquire()`, if it is itself not superseded, terminates by either
     * acquiring (held=true) or recording the live failure (held=false, error set) —
     * neither path retries. So a denied environment that keeps rejecting does not
     * recurse; the retry chain length is bounded by the number of external overlaps.
     */
    private _retryIfStillDesired;
    private _onRelease;
    /**
     * Lease renewal after an OS release while the page is still visible. Honors the
     * "keep awake *while* active" promise for releases that do NOT coincide with a
     * visibility change (battery-low / power-saver), which otherwise leave the lock
     * stuck at desired=true / held=false until the next hide→show cycle.
     *
     * Bounded on failure: this only runs from `_onRelease`, which only fires when a
     * sentinel was genuinely acquired and then released. A re-acquire that FAILS takes
     * `_acquire()`'s live-failure path (error recorded, held=false) and attaches no
     * listener, so it cannot re-enter `_onRelease` — a denied environment records the
     * error once and stops. This is the dominant real path: per the Wake Lock spec a
     * re-request under battery-low / power-saver is rejected (`NotAllowedError`), so the
     * renewal terminates there.
     *
     * The one path NOT bounded by a counter is a pathological host that keeps GRANTING
     * the re-request and then immediately auto-releasing it (grant→release reflux). Each
     * iteration yields to the event loop and consumes a real OS grant, so it is not a
     * tight/synchronous loop, but it would churn request() calls. We deliberately do NOT
     * add a debounce or renewal cap: that reflux is not documented browser behavior
     * (real browsers reject, not grant-then-revoke), and the extra timing state would
     * complicate the pure-sink design to defend a case that does not occur in practice.
     *
     * The `_isVisible()` / `!_acquiring` guards (doubled by `_acquire()`'s own in-flight
     * and held guards) prevent re-entry during an in-flight acquire and while hidden.
     */
    private _reacquireAfterRelease;
    private _onVisibilityChange;
    private _ensureVisibilityListener;
    private _wakeLock;
    private _isVisible;
    private _normalizeError;
}

/**
 * `<wcs-wakelock>` — declarative Screen Wake Lock.
 *
 * The first @wcstack tag that is a pure *sink*: every other sensor is an
 * element→state producer, but the wake lock is state→element. The headline
 * binding is `active@isPlaying` — hold the screen awake while a bound boolean is
 * true. `active` is the single input knob (a mirrored attribute); `held` and
 * `error` are the observable outputs.
 *
 * The OS auto-releases the lock when the page is hidden; the Core re-acquires it
 * on the next return to visibility while `active` is still set, so the binding
 * means "keep awake *while* active", not just "acquire once".
 */
declare class WcsWakeLock extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static observedAttributes: string[];
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get connectedCallbackPromise(): Promise<void>;
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get active(): boolean;
    set active(value: boolean);
    get type(): WakeLockKind;
    set type(value: WakeLockKind);
    get manual(): boolean;
    set manual(value: boolean);
    get held(): boolean;
    get error(): Error | null;
    /** Acquire (and keep) the wake lock. Never rejects — see the `error` property. */
    request(): Promise<void>;
    /** Release the wake lock and stop re-acquiring it. */
    release(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void;
}

export { WakeLockCore, WcsWakeLock, bootstrapWakeLock, getConfig };
export type { IWritableConfig, IWritableTagNames, WakeLockKind, WcsWakeLockCommands, WcsWakeLockCoreCommands, WcsWakeLockCoreValues, WcsWakeLockInputs, WcsWakeLockValues };

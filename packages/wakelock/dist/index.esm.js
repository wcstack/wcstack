const _config = {
    tagNames: {
        wakelock: "wcs-wakelock",
    },
};
function deepFreeze(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
        deepFreeze(obj[key]);
    }
    return obj;
}
function deepClone(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    const clone = {};
    for (const key of Object.keys(obj)) {
        clone[key] = deepClone(obj[key]);
    }
    return clone;
}
let frozenConfig = null;
// Note: this is the live, mutable internal config. It is not part of the public
// package exports (see exports.ts) — only `getConfig()` (a frozen snapshot) is
// surfaced. `setConfig()` is applied internally via `bootstrapWakeLock()` and
// is not re-exported from the package root, though a deep path import
// (`.../src/config.js`) can still reach and mutate it. Accepted as-is for
// cross-package consistency: every @wcstack package follows this same shape.
// Use `getConfig()` for a frozen, safe read.
const config = _config;
function getConfig() {
    if (!frozenConfig) {
        frozenConfig = deepFreeze(deepClone(_config));
    }
    return frozenConfig;
}
function setConfig(partialConfig) {
    if (partialConfig.tagNames) {
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    frozenConfig = null;
}

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
class WakeLockCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "held", event: "wcs-wakelock:held-changed" },
            { name: "error", event: "wcs-wakelock:error" },
        ],
        commands: [
            { name: "request", async: true },
            { name: "release" },
        ],
    };
    _target;
    _type;
    // `_active` is the desired intent (input); `_held` is whether a sentinel is
    // actually held right now (output). They diverge across an OS auto-release.
    _active = false;
    _held = false;
    _error = null;
    _sentinel = null;
    // Bumped on every release()/new acquire so an in-flight async request() that
    // resolves late can detect it was superseded and drop its sentinel (mirrors the
    // generation guards in GeolocationCore).
    _gen = 0;
    // True while an `_acquire()` is awaiting `navigator.wakeLock.request()`. The
    // `_held` flag is only set *after* that await resolves, so it cannot guard
    // against concurrent entry: two rapid visibilitychange events (or a Shell toggle
    // overlapping an in-flight request) would both pass `!this._held` and each call
    // `request()`. This in-flight flag closes that window — a re-entrant acquire is a
    // no-op. The `_gen` guard still ensures the *final* state is correct; this just
    // avoids the redundant `request()` call (and its duplicate error path on a denied
    // environment).
    _acquiring = false;
    _visibilityBound = false;
    // SSR (§3.8): a pure sink has no asynchronous probe to await — `request()` is
    // fire-and-forget and meaningless server-side — so readiness is immediate.
    _ready = Promise.resolve();
    constructor(target, type = "screen") {
        super();
        this._target = target ?? this;
        this._type = type;
    }
    get ready() {
        return this._ready;
    }
    // Lifecycle (§3.5). The wake lock is command-driven (request / release) with no
    // ambient subscription to establish on connect, so observe() is an idempotent
    // no-op that resolves once ready; dispose() (below) tears down the visibility
    // listener, releases any held sentinel, and bumps _gen via release().
    observe() {
        return this._ready;
    }
    get held() {
        return this._held;
    }
    get error() {
        return this._error;
    }
    /** The desired intent. Read-only reflection; not a wc-bindable property (it does
     * not change on an OS auto-release, so there is nothing to observe). */
    get active() {
        return this._active;
    }
    get type() {
        return this._type;
    }
    set type(value) {
        // Currently effectively a no-op: "screen" is the only standardized lock type,
        // so `WakeLockKind` is a single value and this setter never observes a real
        // change. Kept as a forward-compatible seam for when the spec adds lock types.
        //
        // Takes effect on the next acquire. Changing the type mid-hold deliberately does
        // NOT re-acquire — the live sentinel is left as is, so a type change applies only
        // from the following acquire. If multiple lock types are ever added this becomes
        // an observable behavior gap (a held lock keeps its old type until release/re-
        // acquire) and must be re-examined — likely re-acquire here when held.
        this._type = value;
    }
    // --- State setters with event dispatch ---
    _setHeld(held) {
        if (this._held === held)
            return;
        this._held = held;
        this._target.dispatchEvent(new CustomEvent("wcs-wakelock:held-changed", {
            detail: held,
            bubbles: true,
        }));
    }
    _setError(error) {
        // Value guard, not just reference: a denied request rejects with a *fresh*
        // Error on every visibility-driven retry, so a reference compare would let a
        // permanently-denied environment re-dispatch the same failure on each
        // hidden→visible toggle. Compare name+message too. Transitions through null (a
        // success clears the error) always re-fire, so a genuinely new failure is seen.
        if (this._sameError(this._error, error))
            return;
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-wakelock:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _sameError(a, b) {
        if (a === b)
            return true;
        if (a !== null && b !== null)
            return a.name === b.name && a.message === b.message;
        return false;
    }
    // --- Public API ---
    /**
     * Mark the lock as desired and acquire it. Idempotent while already held. If the
     * API is unavailable or the page is currently hidden, the desired flag is still
     * set (so the lock is acquired on the next return to visibility) but nothing is
     * acquired now. Never rejects — a request failure surfaces via `error`.
     */
    async request() {
        this._active = true;
        this._ensureVisibilityListener();
        await this._acquire();
    }
    /** Mark the lock as no longer desired and release any held sentinel. */
    release() {
        this._active = false;
        // Invalidate any in-flight acquire so a late-resolving request() drops its
        // sentinel instead of leaving a lock held after release.
        this._gen++;
        const sentinel = this._sentinel;
        if (sentinel) {
            this._sentinel = null;
            sentinel.removeEventListener("release", this._onRelease);
            void sentinel.release().catch(() => { });
        }
        this._setHeld(false);
    }
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
    dispose() {
        if (this._visibilityBound) {
            // §4 deviation: document-scoped Web API; no element-free alternative — the
            // Page Visibility `visibilitychange` event is only dispatched on `document`.
            document.removeEventListener("visibilitychange", this._onVisibilityChange);
            this._visibilityBound = false;
        }
        this.release();
    }
    // --- Internal ---
    async _acquire() {
        if (this._held)
            return; // idempotent: already holding a sentinel
        if (this._acquiring)
            return; // an acquire is already in flight — don't double-request
        const wakeLock = this._wakeLock();
        if (!wakeLock)
            return; // unsupported — stay active, never acquire (silent no-op)
        if (!this._isVisible())
            return; // hidden — defer to the next visibilitychange
        const gen = ++this._gen;
        this._acquiring = true;
        // Flag management is centralized in `finally` and the coalesced retry is invoked
        // exactly once, AFTER the try/catch/finally settles. This keeps the reject and
        // resolve paths symmetric: neither calls `_retryIfStillDesired()` from inside the
        // try/catch (which would let `finally` re-clear the `_acquiring=true` the retry's
        // synchronous re-entry just set, reopening the double-request window). `superseded`
        // records that a newer release()/request() bumped `_gen` mid-flight so its still-
        // live intent — blocked by the in-flight guard at the time — gets one retry here.
        // NOTE: no early `return` inside the try/catch below — every branch must fall
        // through to the post-`finally` retry. A `return` from inside the try would run
        // `finally` and then exit the function, skipping the `if (superseded)` retry.
        let superseded = false;
        let sentinel = null;
        let failed = null;
        try {
            sentinel = await wakeLock.request(this._type);
        }
        catch (e) {
            if (gen !== this._gen) {
                // Superseded while awaiting — drop this stale failure (do not clobber the
                // newer state) and let the post-finally retry honor the live intent.
                superseded = true;
            }
            else {
                failed = this._normalizeError(e);
            }
        }
        finally {
            // The sole owner of the flag clears it here — on every exit path. A concurrent
            // re-entrant `_acquire()` was a no-op at the `_acquiring` guard, so it never owns
            // the flag; a superseding release()/acquire only bumps `_gen` and does not start
            // its own in-flight cycle until this clears the flag. Because this runs before
            // the retry below, the retry's `_acquiring=true` is never clobbered.
            this._acquiring = false;
        }
        if (sentinel !== null && gen !== this._gen) {
            // release() (or a newer acquire) ran while we awaited — this sentinel is
            // unwanted; drop it so no lock lingers, and retry the newer intent below.
            void sentinel.release().catch(() => { });
            superseded = true;
        }
        else if (sentinel !== null) {
            this._sentinel = sentinel;
            sentinel.addEventListener("release", this._onRelease);
            this._setError(null);
            this._setHeld(true);
        }
        else if (failed !== null) {
            // A live (non-superseded) failure: surface it. Never retried — the intent is
            // honored but the environment denied it, so looping would spin.
            this._setError(failed);
            this._setHeld(false);
        }
        // Coalesced retry: at most one re-attempt per supersession, after the flag is
        // clear. The `_acquiring` guard inside still protects any concurrent re-entry that
        // overlaps THIS retry's own in-flight window (reject- and resolve-retry alike).
        if (superseded)
            this._retryIfStillDesired();
    }
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
    _retryIfStillDesired() {
        if (this._active && !this._held && this._isVisible()) {
            void this._acquire();
        }
    }
    // Fired for an OS release of a held sentinel — which the spec allows for several
    // reasons, NOT only a visibility change: tab hidden / window minimized, but also
    // battery-low, power-saver mode, etc. while the page stays visible. We reflect
    // held=false, then (lease renewal) re-acquire immediately IF the page is still
    // visible and the lock is still desired — because a visible-context release emits no
    // `visibilitychange`, so the visibilitychange listener (②) would never fire and the
    // lock would stay stuck at desired=true / held=false. The hidden case is the no-op
    // here: re-acquire is gated on `_isVisible()`, so a hide-driven release defers to ②
    // (re-acquire on the return to visibility), avoiding a release→acquire loop while
    // hidden.
    _onRelease = () => {
        // The `if (this._sentinel)` false branch is defensive and unreachable in practice:
        // this listener is only ever attached to the live `_sentinel`, and the only paths
        // that null `_sentinel` (this handler itself, and release()) remove this listener
        // in the same step — so the listener and a non-null `_sentinel` are coupled and
        // this never fires with `_sentinel === null`. Guarded anyway in case a host
        // dispatches a spurious second "release". (c8 ignore the unhittable else.)
        /* c8 ignore next */
        if (this._sentinel) {
            this._sentinel.removeEventListener("release", this._onRelease);
            this._sentinel = null;
        }
        this._setHeld(false);
        this._reacquireAfterRelease();
    };
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
    _reacquireAfterRelease() {
        if (this._active && this._isVisible() && !this._acquiring) {
            void this._acquire();
        }
    }
    // ② Re-acquire when the page becomes visible again while the lock is still
    // desired but was auto-released. This is what makes `active` a durable intent.
    _onVisibilityChange = () => {
        if (this._isVisible() && this._active && !this._held) {
            void this._acquire();
        }
    };
    _ensureVisibilityListener() {
        if (this._visibilityBound)
            return;
        // §4 deviation: document-scoped Web API; no element-free alternative — the
        // Page Visibility `visibilitychange` event is only dispatched on `document`.
        document.addEventListener("visibilitychange", this._onVisibilityChange);
        this._visibilityBound = true;
    }
    _wakeLock() {
        return navigator.wakeLock ?? null;
    }
    _isVisible() {
        // §4 deviation: document-scoped Web API; no element-free alternative —
        // `visibilityState` lives on `document`, not on any element.
        return document.visibilityState === "visible";
    }
    _normalizeError(e) {
        return e instanceof Error ? e : new Error(String(e));
    }
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
class WcsWakeLock extends HTMLElement {
    // SSR contract (§4.1/@wcstack/server): the renderer awaits elements declaring
    // `hasConnectedCallbackPromise = true` before snapshotting. The wake lock has no
    // connect-time async probe to await (acquire is fire-and-forget and meaningless
    // server-side), so `connectedCallbackPromise` is backed by the Core's no-op
    // `observe()`, which resolves immediately. The flag is still declared `true` so
    // the renderer reads it via `ctor.hasConnectedCallbackPromise` and the Shell
    // participates uniformly in the SSR await protocol.
    static hasConnectedCallbackPromise = true;
    // `active` drives request/release; `type` propagates to the Core's next acquire.
    // `manual` is intentionally excluded: it is a connect-time policy ("don't auto-
    // acquire on connect"), not a live switch.
    static observedAttributes = ["active", "type"];
    static wcBindable = {
        ...WakeLockCore.wcBindable,
        // Settable surface. `active` is the declarative intent; `type` selects the lock
        // kind; `manual` opts out of auto-acquire on connect. The request / release
        // commands are inherited from the Core via the spread above.
        inputs: [
            { name: "active", attribute: "active" },
            { name: "type", attribute: "type" },
            { name: "manual", attribute: "manual" },
        ],
        // Core の commands をそのまま継承（単一情報源）。<wcs-intersect>/<wcs-sse> と同型。
        // spread でも継承されるが、Core に command 追加時の追従漏れを防ぐため明示参照する。
        commands: WakeLockCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new WakeLockCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-wakelock:held-changed": (d) => ({ held: d === true }),
            "wcs-wakelock:error": (d) => ({ error: d != null }),
        });
    }
    // SSR (§4.1): the renderer awaits this before snapshotting. Backed by the Core's
    // observe() (a no-op resolving immediately for this command-driven sink).
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
    // wc-bindable (not a bind target); see README "CSS styling with :state()".
    // MUST NOT return the live CustomStateSet (that would let callers write
    // states from outside, defeating the point of :state() being read-only).
    get debugStates() {
        return this._internals ? [...this._internals.states] : [];
    }
    _initInternals() {
        // never-throw (async-io-node-guidelines.md §3.6): attachInternals is absent
        // in happy-dom / older environments, and pre-125 Chromium rejects
        // non-dashed state names from states.add() (probed and discarded here).
        // Either case silently disables reflection — the component still works,
        // it just doesn't expose :state() selectors.
        try {
            if (typeof this.attachInternals !== "function")
                return null;
            const internals = this.attachInternals();
            internals.states.add("wcs-probe");
            internals.states.delete("wcs-probe");
            return internals;
        }
        catch {
            return null;
        }
    }
    _wireStates(map) {
        if (this._internals === null)
            return;
        const states = this._internals.states;
        for (const [event, toStates] of Object.entries(map)) {
            this.addEventListener(event, (e) => {
                const debug = this.hasAttribute("debug-states");
                for (const [name, on] of Object.entries(toStates(e.detail))) {
                    try {
                        // The ternary expression-statement form trips ESLint no-unused-expressions.
                        if (on) {
                            states.add(name);
                        }
                        else {
                            states.delete(name);
                        }
                    }
                    catch { /* never-throw */ }
                    if (debug)
                        this.toggleAttribute(`data-wcs-state-${name}`, on);
                }
            });
        }
    }
    // --- Attribute accessors ---
    get active() {
        // Reflects the *attribute*, not the Core's desired intent (`_core.active`). These
        // can diverge: invoking the `request` / `release` commands directly (e.g. via a
        // command-token binding) flips the Core's desired flag without touching the
        // attribute, so `el.active` may read false while `el.held` is true (or vice
        // versa). The attribute is the declarative input surface; the commands are an
        // imperative side door. Bind via `active@...` for a single source of truth.
        return this.hasAttribute("active");
    }
    set active(value) {
        if (value) {
            this.setAttribute("active", "");
        }
        else {
            this.removeAttribute("active");
        }
    }
    get type() {
        // Only "screen" is standardized; an absent/empty attribute defaults to it.
        return this.getAttribute("type") || "screen";
    }
    set type(value) {
        this.setAttribute("type", value);
    }
    get manual() {
        return this.hasAttribute("manual");
    }
    set manual(value) {
        if (value) {
            this.setAttribute("manual", "");
        }
        else {
            this.removeAttribute("manual");
        }
    }
    // --- Core delegated getters ---
    get held() {
        return this._core.held;
    }
    get error() {
        return this._core.error;
    }
    // --- Commands ---
    /** Acquire (and keep) the wake lock. Never rejects — see the `error` property. */
    request() {
        return this._core.request();
    }
    /** Release the wake lock and stop re-acquiring it. */
    release() {
        this._core.release();
    }
    // --- Lifecycle ---
    connectedCallback() {
        // Headless resource: no layout box (mirrors the @wcstack sensor convention).
        this.style.display = "none";
        // Propagate the requested lock type to the Core. Currently a no-op in effect:
        // "screen" is the only standardized type, so `type` is always "screen". Wired
        // up as a forward-compatible seam (observedAttributes + setter + this line) for
        // when the spec adds lock types; until then it carries a constant.
        this._core.type = this.type;
        // Establish monitoring (§3.5) and expose readiness for SSR (§4.1). observe()
        // is a no-op that resolves immediately for this command-driven sink.
        this._connectedCallbackPromise = this._core.observe();
        if (!this.manual && this.active) {
            void this._core.request();
        }
    }
    disconnectedCallback() {
        this._core.dispose();
    }
    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue)
            return;
        // Ignore changes applied before connect (e.g. createElement + setAttribute);
        // connectedCallback applies the initial state. Acquiring a lock for a detached
        // element would be wrong.
        if (!this.isConnected)
            return;
        if (name === "type") {
            this._core.type = this.type;
            return;
        }
        // name === "active": a live toggle always drives request/release. `manual` only
        // gates the connect-time auto-acquire, not an explicit author toggle.
        if (this.active) {
            void this._core.request();
        }
        else {
            this._core.release();
        }
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.wakelock)) {
        customElements.define(config.tagNames.wakelock, WcsWakeLock);
    }
}

function bootstrapWakeLock(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { WakeLockCore, WcsWakeLock, bootstrapWakeLock, getConfig };
//# sourceMappingURL=index.esm.js.map

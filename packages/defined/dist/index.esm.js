const _config = {
    tagNames: {
        defined: "wcs-defined",
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
 * Headless custom-element readiness primitive. A thin, framework-agnostic wrapper
 * around `customElements.whenDefined()` exposed through the wc-bindable protocol.
 *
 * Like `@wcstack/permission`, this is a **one-way element → state monitor** with
 * **no commands** (event-token only): there is no imperative action to "define" a
 * tag, only observation of when registration completes. Unlike permission, the
 * underlying signal is **monotonic** — once a tag is defined it never reverts — so
 * the state machine is terminal: it settles once every tag resolves, or once the
 * optional `timeout` elapses.
 *
 * The differentiator from CSS `:not(:defined)` is **timeout-based failure
 * detection**. An autoloader-imported component whose module fails to load leaves
 * `whenDefined` pending forever; CSS can only keep hiding it. Here, the `timeout`
 * moves still-pending tags into `missing`, so a load failure becomes observable
 * state (`missing.length > 0`) that can drive a fallback UI.
 *
 * Six observable properties are all derived from a single `wcs-defined:change`
 * event whose `detail` is the full {@link DefinedSnapshot} (mirroring how
 * PermissionCore exposes granted/denied/… from one event). At every dispatch the
 * invariant `total === count + pending.length + missing.length` holds; `pending`
 * and `missing` partition the not-yet-defined tags, split by the timeout.
 */
class DefinedCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "defined", event: "wcs-defined:change", getter: (e) => e.detail.defined },
            { name: "pending", event: "wcs-defined:change", getter: (e) => e.detail.pending },
            { name: "missing", event: "wcs-defined:change", getter: (e) => e.detail.missing },
            { name: "count", event: "wcs-defined:change", getter: (e) => e.detail.count },
            { name: "total", event: "wcs-defined:change", getter: (e) => e.detail.total },
            { name: "error", event: "wcs-defined:change", getter: (e) => e.detail.error },
        ],
        // No commands: whenDefined is a pure observer (read-only). See class docs.
        commands: [],
    };
    _target;
    _defined = false;
    _pending = [];
    _missing = [];
    _count = 0;
    _total = 0;
    _error = null;
    _mode = "all";
    // Active timeout handle (when `timeout > 0`), kept so dispose() can clear it.
    _timeoutId = null;
    // True once a watch has been established, reset by dispose(). Guards observe()
    // so a reconnect re-inits while a redundant observe() on a live watch does not.
    _subscribed = false;
    // Monotonic id of the current watch. Bumped by every _init() and by dispose().
    // Each in-flight whenDefined()/timeout callback captures the id and bails unless
    // it is still current — so a callback that settles after a dispose(), or after a
    // rapid disconnect→reconnect, never mutates the live state.
    _gen = 0;
    // JSON of the last snapshot actually dispatched, for the same-value guard.
    // Deliberately NOT reset by _init(), so a dispose()→observe() that reproduces an
    // identical state suppresses a redundant re-dispatch.
    _publishedKey = null;
    // Resolves once the current watch settles (every tag resolved, or the timeout
    // fired, or the config was empty/invalid). The Shell exposes this as
    // connectedCallbackPromise so SSR can await readiness before snapshotting.
    _ready = Promise.resolve();
    _resolveReady = null;
    constructor(tags, mode = "all", timeoutMs = 0, target) {
        super();
        this._target = target ?? this;
        // Headless ergonomics: when tags are supplied up front, start watching
        // immediately so observers see real state before the first read. The Shell
        // passes nothing and drives the first watch from connectedCallback via
        // observe(), once the element's attributes resolve.
        if (tags) {
            this._init(tags, mode, timeoutMs);
        }
    }
    get defined() {
        return this._defined;
    }
    // Arrays are returned as copies so external reads cannot mutate internal state.
    get pending() {
        return [...this._pending];
    }
    get missing() {
        return [...this._missing];
    }
    get count() {
        return this._count;
    }
    get total() {
        return this._total;
    }
    get error() {
        return this._error;
    }
    /** Resolves once the current (or initial) watch settles. */
    get ready() {
        return this._ready;
    }
    // --- Public API ---
    /**
     * Start watching `tags` under `mode` with an optional `timeoutMs`. Idempotent
     * while already subscribed — a second call is a no-op that just returns the live
     * `ready` (the Shell binds at a fixed connect-time config and does not re-watch
     * on attribute changes in v1). To switch config mid-life, dispose() first, then
     * observe() again. Returns a promise that resolves once the watch settles, for SSR.
     */
    observe(tags, mode, timeoutMs) {
        if (!this._subscribed) {
            this._init(tags, mode, timeoutMs);
        }
        return this._ready;
    }
    /**
     * Stop the current watch: clear the timeout and invalidate any in-flight
     * whenDefined()/timeout callbacks (via the generation counter) so they no longer
     * mutate state. Call from the Shell's `disconnectedCallback`. A later observe()
     * can re-establish the watch. Safe to call when never subscribed.
     */
    dispose() {
        this._subscribed = false;
        this._gen++;
        if (this._timeoutId !== null) {
            clearTimeout(this._timeoutId);
            this._timeoutId = null;
        }
        // Settle a still-pending watch as cancelled, so a consumer awaiting `ready`
        // (or the Shell's connectedCallbackPromise) does not hang forever when the
        // element is disposed before every tag resolved. Resolving an already-settled
        // promise is a no-op; null'ing the resolver makes a later dispose() a safe
        // no-op until the next observe() installs a fresh one.
        this._resolveReady?.();
        this._resolveReady = null;
    }
    // --- Internal ---
    _init(tags, mode, timeoutMs) {
        this._mode = mode;
        this._pending = [];
        this._missing = [];
        this._count = 0;
        this._error = null;
        this._total = tags.length;
        this._subscribed = true;
        const gen = ++this._gen;
        this._ready = new Promise((resolve) => {
            this._resolveReady = resolve;
        });
        // Empty config: surface the misconfiguration deterministically and keep
        // `defined` false (do NOT let count===total === 0===0 read as defined).
        if (tags.length === 0) {
            this._error = "no tags specified";
            this._recompute();
            this._publish();
            this._finishIfDone();
            return;
        }
        for (const tag of tags) {
            // Already registered (e.g. the autoloader defined it before connect): count
            // it synchronously, no listener needed.
            if (customElements.get(tag)) {
                this._count++;
                continue;
            }
            this._pending.push(tag);
            // whenDefined() resolves when the tag is registered. An invalid name is
            // reported as a rejected promise on current (WHATWG) implementations, but as
            // a *synchronous throw* on some legacy/polyfill implementations. Handle both
            // so the class's never-throw guarantee holds regardless of environment — the
            // bad tag surfaces as `error` + `missing` either way.
            try {
                customElements.whenDefined(tag).then(() => {
                    if (gen !== this._gen)
                        return;
                    const pi = this._pending.indexOf(tag);
                    if (pi !== -1) {
                        this._pending.splice(pi, 1);
                    }
                    else {
                        // The timeout already moved this tag to `missing`; a late registration
                        // promotes it back into the defined count (decision: missing→count).
                        this._missing.splice(this._missing.indexOf(tag), 1);
                    }
                    this._count++;
                    this._recompute();
                    this._publish();
                    this._finishIfDone();
                }, () => {
                    if (gen !== this._gen)
                        return;
                    // Invalid name (async reject path). The rejection runs as a microtask
                    // before any timeout, so the tag is still in `pending` here.
                    this._markInvalid(tag);
                    this._recompute();
                    this._publish();
                    this._finishIfDone();
                });
            }
            catch {
                // Invalid name (synchronous-throw environment). The tag was just pushed to
                // `pending` above; route it through the same missing+error handling. The
                // end-of-loop publish below reflects it, so no per-tag publish is needed.
                this._markInvalid(tag);
            }
        }
        this._recompute();
        this._publish();
        this._finishIfDone();
        if (timeoutMs > 0) {
            // No generation guard here: dispose() (the only thing that invalidates this
            // watch) clears this timeout, so a stale-gen callback can never fire. The
            // resolve/reject handlers above DO need the guard — pending promises cannot
            // be cancelled the way a timer can.
            this._timeoutId = setTimeout(() => {
                if (this._pending.length === 0)
                    return;
                this._missing.push(...this._pending);
                this._pending = [];
                this._recompute();
                this._publish();
                this._finishIfDone();
            }, timeoutMs);
        }
    }
    // `defined` is the aggregation of `count` against `total` per mode. For `all`,
    // `total > 0` guards the empty config (decision: empty → not defined).
    _recompute() {
        this._defined = this._mode === "any"
            ? this._count >= 1
            : this._total > 0 && this._count === this._total;
    }
    // Record `tag` as undefinable: drop it from `pending` and add it to `missing`
    // with a reason. Shared by the async reject path and the sync-throw fallback.
    // The tag is guaranteed to be in `pending` when this runs — the reject fires
    // before any timeout, and the sync path runs in the same iteration that pushed
    // it — so the unconditional splice is safe.
    _markInvalid(tag) {
        this._pending.splice(this._pending.indexOf(tag), 1);
        this._missing.push(tag);
        this._appendError(`invalid custom element name: ${tag}`);
    }
    _appendError(message) {
        this._error = this._error ? `${this._error}; ${message}` : message;
    }
    _snapshot() {
        return {
            defined: this._defined,
            pending: [...this._pending],
            missing: [...this._missing],
            count: this._count,
            total: this._total,
            error: this._error,
        };
    }
    _publish() {
        const snap = this._snapshot();
        // Same-value guard: suppress a dispatch identical to the last published one.
        // The snapshot has a fixed key order, so its JSON is a stable identity key.
        const key = JSON.stringify(snap);
        if (this._publishedKey === key)
            return;
        this._publishedKey = key;
        this._target.dispatchEvent(new CustomEvent("wcs-defined:change", {
            detail: snap,
            bubbles: true,
        }));
    }
    // Terminal once nothing is pending (all resolved, or the timeout drained them,
    // or the config was empty). Resolving an already-resolved promise is a no-op, so
    // a late promotion after the timeout does not need to re-resolve.
    _finishIfDone() {
        if (this._pending.length === 0) {
            this._resolveReady?.();
        }
    }
}

// Named WcsDefined (not `Defined`) to match the <wcs-permission> / <wcs-geo>
// convention (WcsPermission / WcsGeolocation) and avoid shadowing any global.
class WcsDefined extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...DefinedCore.wcBindable,
        // Shell-level settable surface: what to watch and how. All three reflect
        // idempotently as plain attributes, so a binding system writing through
        // inputs[].attribute is safe.
        inputs: [
            { name: "tags", attribute: "tags" },
            { name: "mode", attribute: "mode" },
            { name: "timeout", attribute: "timeout" },
        ],
        // No commands: read-only monitor (see DefinedCore). whenDefined cannot be
        // triggered imperatively — it only observes.
        commands: [],
    };
    // Created with no tags so the delegated getters work before connect (returning
    // the defaults: defined=false, empty arrays, count/total 0). The actual watch is
    // driven from connectedCallback once the element's attributes resolve
    // (programmatically-created elements have no attributes at construction time).
    _core;
    _connectedCallbackPromise = Promise.resolve();
    constructor() {
        super();
        this._core = new DefinedCore(undefined, "all", 0, this);
    }
    // --- Attribute accessors ---
    get tags() {
        return this.getAttribute("tags") ?? "";
    }
    set tags(value) {
        this.setAttribute("tags", value);
    }
    get mode() {
        return this.getAttribute("mode") === "any" ? "any" : "all";
    }
    set mode(value) {
        this.setAttribute("mode", value);
    }
    get timeout() {
        return Number(this.getAttribute("timeout")) || 0;
    }
    set timeout(value) {
        this.setAttribute("timeout", String(value));
    }
    // --- Core delegated getters ---
    get defined() {
        return this._core.defined;
    }
    get pending() {
        return this._core.pending;
    }
    get missing() {
        return this._core.missing;
    }
    get count() {
        return this._core.count;
    }
    get total() {
        return this._core.total;
    }
    get error() {
        return this._core.error;
    }
    // wc-bindable connectedCallbackPromise protocol: resolves once the connect-time
    // watch settles, so SSR (@wcstack/server render.ts) waits for readiness before
    // snapshotting the HTML. Mirrors WcsPermission.connectedCallbackPromise.
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // --- Internal ---
    // Parse the comma-separated `tags` attribute into trimmed, non-empty tag names.
    _parseTags() {
        return this.tags.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    }
    // --- Lifecycle ---
    connectedCallback() {
        this.style.display = "none";
        // Begin the watch (or revive it after a reconnect). The returned promise is
        // held as connectedCallbackPromise for SSR. whenDefined failures surface as
        // `missing` / `error` state — never as a throw — so no .catch() is needed.
        this._connectedCallbackPromise = this._core.observe(this._parseTags(), this.mode, this.timeout);
    }
    disconnectedCallback() {
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.defined)) {
        customElements.define(config.tagNames.defined, WcsDefined);
    }
}

function bootstrapDefined(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { DefinedCore, WcsDefined, bootstrapDefined, getConfig };
//# sourceMappingURL=index.esm.js.map

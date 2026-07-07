const _config = {
    tagNames: {
        share: "wcs-share",
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
 * Headless Web Share primitive. A thin, framework-agnostic wrapper around
 * `navigator.share(data)` exposed through the wc-bindable protocol.
 *
 * This is a simplified derivative of `FetchCore._doFetch`
 * (docs/web-share-tag-design.md §2): it keeps the single `_gen` generation
 * guard, the same-value-guarded private setters, and the never-throw
 * try/catch wrapper, but drops `AbortController`/`abort()` entirely —
 * `navigator.share()` accepts no `AbortSignal` and there is no platform
 * mechanism for a caller to cancel an in-flight share dialog. A share dialog
 * is also a single system-modal surface (at most one open at a time), so the
 * "a new call supersedes the previous one" plumbing that `FetchCore` needs
 * has no counterpart here either.
 */
class ShareCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "value", event: "wcs-share:complete", getter: (e) => e.detail.value },
            { name: "loading", event: "wcs-share:loading-changed" },
            { name: "error", event: "wcs-share:error" },
            { name: "cancelled", event: "wcs-share:cancelled-changed" },
        ],
        commands: [
            { name: "share", async: true },
        ],
    };
    _target;
    _value = null;
    _loading = false;
    _error = null;
    _cancelled = false;
    // Generation guard (§3.4 of the guidelines): bumped ONLY by dispose(). A
    // share() that settles after dispose() has a stale `gen` and MUST NOT write
    // state to a torn-down element. Unlike FetchCore/EyedropperCore, share()
    // itself does NOT bump `_gen` on each call: docs/web-share-tag-design.md §2
    // deliberately drops the "a new call supersedes the previous one" plumbing
    // those cores need, because the platform allows only one open share dialog
    // at a time (a second concurrent share() rejects with InvalidStateError on
    // its own). Bumping `_gen` per call would instead let a fast-failing second
    // call incorrectly invalidate a still-pending first call's eventual
    // success. Also not bumped on the unsupported early-return — no
    // asynchronous work is started, so there is no generation to protect
    // (docs/web-share-tag-design.md §8).
    _gen = 0;
    // SSR (§3.8): no asynchronous probe to await, so readiness is immediate.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get ready() {
        return this._ready;
    }
    get value() {
        return this._value;
    }
    get loading() {
        return this._loading;
    }
    get error() {
        return this._error;
    }
    get cancelled() {
        return this._cancelled;
    }
    // Lifecycle (§3.5). Share is command-driven with no subscription to
    // establish, so observe() is an idempotent no-op that resolves once ready;
    // dispose() only invalidates any in-flight share() (there is nothing to
    // abort or unsubscribe).
    observe() {
        return this._ready;
    }
    dispose() {
        this._gen++;
    }
    _setLoading(loading) {
        if (this._loading === loading)
            return;
        this._loading = loading;
        this._target.dispatchEvent(new CustomEvent("wcs-share:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    // Deliberately NO same-value guard (unlike error/loading/cancelled below).
    // `value` is a success-completion signal, not idempotent state: it is written
    // only on a successful share(), and wcs-share:complete is the *sole* success
    // notification. Two consecutive successful shares — even with the same `data`
    // object reference, or a data-less share echoing null when value is already
    // null — are two distinct completions and must each re-fire wcs-share:complete
    // so an `$on`/eventToken consumer (and a `value:` binding) sees every success.
    // This matches clipboard `_setRead` / broadcast `_setMessage`, which carve
    // result/event values out of the §3.3 guard for the same reason.
    _setValue(value) {
        this._value = value;
        this._target.dispatchEvent(new CustomEvent("wcs-share:complete", {
            detail: { value },
            bubbles: true,
        }));
    }
    _setError(error) {
        if (this._error === error)
            return;
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-share:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _setCancelled(cancelled) {
        if (this._cancelled === cancelled)
            return;
        this._cancelled = cancelled;
        this._target.dispatchEvent(new CustomEvent("wcs-share:cancelled-changed", {
            detail: cancelled,
            bubbles: true,
        }));
    }
    // API resolution is call-time, never cached (§3.7): lets tests install/remove
    // navigator.share freely and lets an unsupported environment be detected
    // correctly on every call.
    _api() {
        const nav = globalThis.navigator;
        return typeof nav?.share === "function" ? nav.share.bind(nav) : undefined;
    }
    async share(data) {
        // never-throw + unsupported (§8): resolve API at call time and bail out
        // immediately if absent. No _gen bump — no asynchronous work is started,
        // so there is no generation to protect, and navigator.share() itself is
        // never invoked.
        const shareFn = this._api();
        if (!shareFn) {
            this._setError({ message: "Web Share API is not supported in this browser." });
            return null;
        }
        // Captured, not bumped (see the `_gen` field docs above): share() does
        // not supersede a prior in-flight call, only dispose() invalidates.
        const gen = this._gen;
        this._setLoading(true);
        // Reset the previous outcome before starting a new share so a stale
        // cancelled/error does not linger into this call's result
        // (docs/web-share-tag-design.md §3).
        this._setError(null);
        this._setCancelled(false);
        try {
            await shareFn(data);
            // Stale completion (dispose() ran while the share dialog was open).
            // Drop the result without writing state.
            if (gen !== this._gen) {
                return null;
            }
            // navigator.share() resolves `Promise<void>` — there is no payload to
            // read off the API, so `value` is synthesized as an echo of the caller's
            // `data`, signalling "this share completed successfully"
            // (docs/web-share-tag-design.md §4).
            this._setValue(data ?? null);
            this._setLoading(false);
            return data ?? null;
        }
        catch (e) {
            // Stale completion (dispose() ran while the share dialog was open).
            if (gen !== this._gen) {
                return null;
            }
            if (e?.name === "AbortError") {
                // The user dismissed the share sheet — a routine cancellation, not a
                // platform failure. Kept out of `error` (docs/web-share-tag-design.md §3).
                this._setCancelled(true);
            }
            else {
                this._setError(e);
            }
            this._setLoading(false);
            return null;
        }
    }
}

/**
 * `<wcs-share>` — declarative Web Share API primitive.
 *
 * The smallest command-only Shell in the batch (docs/web-share-tag-design.md
 * §10): no attributes at all. `share(data)`'s `data` is a per-call argument,
 * not a declarative setting to park on the element ahead of time.
 */
class WcsShare extends HTMLElement {
    // SSR (§4.4): observe() completes synchronously, but the Shell still exposes
    // connectedCallbackPromise so the state binder can await it uniformly across
    // all IO nodes before snapshotting.
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...ShareCore.wcBindable,
        inputs: [],
        // Core の commands をそのまま継承（単一情報源）。
        commands: ShareCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    constructor() {
        super();
        this._core = new ShareCore(this);
    }
    // --- Core delegated getters ---
    get value() {
        return this._core.value;
    }
    get loading() {
        return this._core.loading;
    }
    get error() {
        return this._core.error;
    }
    get cancelled() {
        return this._core.cancelled;
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // --- Commands ---
    share(data) {
        return this._core.share(data);
    }
    /**
     * Synchronous, side-effect-free delegation to `navigator.canShare(data)`
     * (docs/web-share-tag-design.md §6). Deliberately outside `wcBindable`
     * (not a `properties`/`commands` entry): the platform method takes an
     * argument that varies per call, which does not fit the "observe with no
     * arguments" shape of a bindable property, and is synchronous, which does
     * not fit the fire-and-observe-via-event shape of a command.
     *
     * No never-throw wrapping: the platform method itself is synchronous and
     * side-effect-free, so a throw here would indicate a browser bug rather
     * than a condition this Shell should paper over. `navigator.canShare` is
     * still resolved defensively (some environments lack it even when `share`
     * exists), returning `false` rather than throwing in that case.
     */
    canShare(data) {
        const nav = globalThis.navigator;
        return typeof nav?.canShare === "function" ? nav.canShare(data) : false;
    }
    // --- Lifecycle ---
    connectedCallback() {
        this.style.display = "none";
        this._connectedCallbackPromise = this._core.observe();
    }
    disconnectedCallback() {
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.share)) {
        customElements.define(config.tagNames.share, WcsShare);
    }
}

function bootstrapShare(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { ShareCore, WcsShare, bootstrapShare, getConfig };
//# sourceMappingURL=index.esm.js.map

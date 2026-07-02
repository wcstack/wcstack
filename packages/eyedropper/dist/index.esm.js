const _config = {
    tagNames: {
        eyedropper: "wcs-eyedropper",
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
 * Headless EyeDropper primitive. A thin, framework-agnostic wrapper around
 * `new EyeDropper().open(options)` exposed through the wc-bindable protocol.
 *
 * This is a simplified derivative of `FetchCore._doFetch`
 * (docs/eyedropper-tag-design.md §1, docs/web-share-tag-design.md §2): it
 * keeps the single `_gen` generation guard, the same-value-guarded private
 * setters, and the never-throw try/catch wrapper — the same skeleton
 * `@wcstack/share`'s `ShareCore` uses.
 *
 * Unlike `ShareCore`, this Core **does** restore `AbortController`/`abort()`
 * (docs/eyedropper-tag-design.md §2): `EyeDropper.open()` accepts a `{signal}`
 * option, so — unlike Web Share — a caller has a real platform mechanism to
 * cancel an in-flight color pick. The shape mirrors `FetchCore.abort()`
 * (packages/fetch/src/core/FetchCore.ts:159-164) including the identity check
 * on the locally-held `AbortController` in the `finally` block
 * (packages/fetch/src/core/FetchCore.ts:312-314), so a fast abort()→open()
 * sequence never lets a stale controller null out the new call's controller.
 *
 * Both the user dismissing the picker with Escape and the caller invoking
 * `abort()` reject `open()` with the same `AbortError` — both land on
 * `cancelled` without distinction (docs/eyedropper-tag-design.md §2).
 */
class EyedropperCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "value", event: "wcs-eyedropper:complete", getter: (e) => e.detail.value },
            { name: "loading", event: "wcs-eyedropper:loading-changed" },
            { name: "error", event: "wcs-eyedropper:error" },
            { name: "cancelled", event: "wcs-eyedropper:cancelled-changed" },
        ],
        commands: [
            { name: "open", async: true },
            { name: "abort" },
        ],
    };
    _target;
    _value = null;
    _loading = false;
    _error = null;
    _cancelled = false;
    _abortController = null;
    // Generation guard (§3.4 of the guidelines): bumped on dispose() (and each
    // open() start). An open() that settles after dispose() has a stale `gen`
    // and MUST NOT write state to a torn-down element. Not bumped on the
    // unsupported early-return — no asynchronous work is started, so there is
    // no generation to protect (docs/eyedropper-tag-design.md §4).
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
    // Lifecycle (§3.5). EyeDropper is command-driven with no subscription to
    // establish, so observe() is an idempotent no-op that resolves once ready;
    // dispose() invalidates any in-flight open() and aborts it.
    observe() {
        return this._ready;
    }
    dispose() {
        this._gen++;
        this.abort();
    }
    _setLoading(loading) {
        if (this._loading === loading)
            return;
        this._loading = loading;
        this._target.dispatchEvent(new CustomEvent("wcs-eyedropper:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    _setValue(value) {
        if (this._value === value)
            return;
        this._value = value;
        this._target.dispatchEvent(new CustomEvent("wcs-eyedropper:complete", {
            detail: { value },
            bubbles: true,
        }));
    }
    _setError(error) {
        if (this._error === error)
            return;
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-eyedropper:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _setCancelled(cancelled) {
        if (this._cancelled === cancelled)
            return;
        this._cancelled = cancelled;
        this._target.dispatchEvent(new CustomEvent("wcs-eyedropper:cancelled-changed", {
            detail: cancelled,
            bubbles: true,
        }));
    }
    // API resolution is call-time, never cached (§3.7): lets tests install/remove
    // the global EyeDropper constructor freely and lets an unsupported
    // environment (non-Chromium browsers, as of 2026) be detected correctly on
    // every call (docs/eyedropper-tag-design.md §4).
    _api() {
        const g = globalThis;
        return typeof g.EyeDropper === "function" ? g.EyeDropper : undefined;
    }
    /**
     * Cancels an in-flight `open()` call, if any. A no-op when no open() is in
     * flight (no AbortController has been created yet, or the previous one has
     * already settled) — mirrors `FetchCore.abort()`
     * (packages/fetch/src/core/FetchCore.ts:159-164).
     */
    abort() {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }
    async open() {
        // never-throw + unsupported (§4): resolve API at call time and bail out
        // immediately if absent. No _gen bump — no asynchronous work is started,
        // so there is no generation to protect, and `new EyeDropper()` is never
        // constructed.
        const EyeDropperCtor = this._api();
        if (!EyeDropperCtor) {
            this._setError({ message: "EyeDropper API is not supported in this browser." });
            return null;
        }
        // Cancel any previous in-flight pick before starting a new one (mirrors
        // FetchCore._doFetch's `this.abort()` at the top).
        this.abort();
        // Hold the controller in a local so the finally block (which can run after
        // a subsequent open() has already replaced this._abortController) only
        // clears the field when it still owns it — identical identity check to
        // FetchCore._doFetch (packages/fetch/src/core/FetchCore.ts:312-314). This
        // is what keeps a fast abort()→open() sequence from letting a stale
        // controller null out the new call's controller.
        const ac = new AbortController();
        this._abortController = ac;
        const { signal } = ac;
        const gen = ++this._gen;
        this._setLoading(true);
        // Reset the previous outcome before starting a new open() so a stale
        // cancelled/error does not linger into this call's result
        // (docs/eyedropper-tag-design.md §1, docs/web-share-tag-design.md §3).
        this._setError(null);
        this._setCancelled(false);
        try {
            const result = await new EyeDropperCtor().open({ signal });
            // Stale completion (dispose() ran, or a superseding open() ran, while
            // the picker was open). Drop the result without writing state.
            if (gen !== this._gen) {
                return null;
            }
            // The platform's own result object ({ sRGBHex }) is used verbatim — no
            // synthesis needed, unlike Web Share's `value`
            // (docs/eyedropper-tag-design.md §3).
            this._setValue(result);
            this._setLoading(false);
            return result;
        }
        catch (e) {
            // Stale completion (dispose() ran, or a superseding open() ran, while
            // the picker was open).
            if (gen !== this._gen) {
                return null;
            }
            if (e?.name === "AbortError") {
                // Either the user dismissed the picker with Escape, or the caller
                // invoked abort() — both are a routine cancellation, not a platform
                // failure, and are not distinguished (docs/eyedropper-tag-design.md
                // §2). Kept out of `error`.
                this._setCancelled(true);
            }
            else {
                this._setError(e);
            }
            this._setLoading(false);
            return null;
        }
        finally {
            if (this._abortController === ac) {
                this._abortController = null;
            }
        }
    }
}

/**
 * `<wcs-eyedropper>` — declarative EyeDropper API primitive.
 *
 * The smallest command-only Shell in the batch (docs/eyedropper-tag-design.md
 * §5), mirroring `<wcs-share>`: no attributes at all. `open()` takes no
 * per-call argument — the `{signal}` option is supplied internally by the
 * Core's own AbortController, never via the command-token surface.
 */
class WcsEyedropper extends HTMLElement {
    // SSR (§4.4): observe() completes synchronously, but the Shell still exposes
    // connectedCallbackPromise so the state binder can await it uniformly across
    // all IO nodes before snapshotting.
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...EyedropperCore.wcBindable,
        inputs: [],
        // Core の commands をそのまま継承（単一情報源）。
        commands: EyedropperCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    constructor() {
        super();
        this._core = new EyedropperCore(this);
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
    open() {
        return this._core.open();
    }
    abort() {
        this._core.abort();
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
    if (!customElements.get(config.tagNames.eyedropper)) {
        customElements.define(config.tagNames.eyedropper, WcsEyedropper);
    }
}

function bootstrapEyedropper(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { EyedropperCore, WcsEyedropper, bootstrapEyedropper, getConfig };
//# sourceMappingURL=index.esm.js.map

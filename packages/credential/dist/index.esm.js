const _config = {
    tagNames: {
        credential: "wcs-credential",
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
// surfaced. `setConfig()` is applied internally via `bootstrapCredential()` and
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
 * Headless Credential Management primitive. A thin, framework-agnostic
 * wrapper around `navigator.credentials.get()`/`.store()` exposed through the
 * wc-bindable protocol.
 *
 * Reuses batch3's "thin command" archetype established by `@wcstack/share`
 * (docs/credential-tag-design.md): single `_gen` generation guard,
 * same-value-guarded private setters, never-throw try/catch, no
 * `AbortController`/`abort()` command.
 *
 * **v1 scope excludes WebAuthn (`publicKey`)** — see docs/credential-tag-design.md
 * §0. `get()` validates and strips a `publicKey` option rather than silently
 * forwarding it, surfacing the attempt as a scope-violation `error` instead of
 * accidentally supporting WebAuthn through a side door.
 *
 * **`get()`/`store()` share one `_gen`** — an accepted v1 simplification
 * (docs/multi-promise-io-node-design.md): these two operations are used
 * sequentially in real auth flows (store after a successful login, get before
 * attempting one), not naturally concurrently on the same instance. If both
 * ARE invoked concurrently on the same `<wcs-credential>`, the later call's
 * generation bump silently drops the earlier call's completion write. If this
 * limitation actually bites, use two separate `<wcs-credential>` instances
 * (one for get, one for store) rather than reworking the Core.
 */
class CredentialCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "value", event: "wcs-credential:complete", getter: (e) => e.detail.value },
            { name: "loading", event: "wcs-credential:loading-changed" },
            { name: "error", event: "wcs-credential:error" },
            { name: "cancelled", event: "wcs-credential:cancelled-changed" },
        ],
        commands: [
            { name: "get", async: true },
            { name: "store", async: true },
        ],
    };
    _target;
    _value = null;
    _loading = false;
    _error = null;
    _cancelled = false;
    // Generation guard (§3.4): shared by get() and store() (see class docs on
    // the accepted concurrency limitation this implies).
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
    // Lifecycle (§3.5). Command-driven with no subscription to establish, so
    // observe() is an idempotent no-op that resolves once ready; dispose() only
    // invalidates any in-flight get()/store() (there is nothing to unsubscribe).
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
        this._target.dispatchEvent(new CustomEvent("wcs-credential:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    // Deliberately NO same-value guard (unlike error/loading/cancelled below).
    // `value` is a success-completion signal, not idempotent state: it is written
    // only on a successful get()/store(), and wcs-credential:complete is the *sole*
    // success notification. store() echoes the caller's credential argument, so two
    // consecutive successful store() calls with the same object reference are two
    // distinct completions and must each re-fire wcs-credential:complete so an
    // `$on`/eventToken consumer (and a `value:` binding) sees every success. This
    // matches clipboard `_setRead` / broadcast `_setMessage`, which carve
    // result/event values out of the §3.3 guard for the same reason.
    _setValue(value) {
        this._value = value;
        this._target.dispatchEvent(new CustomEvent("wcs-credential:complete", {
            detail: { value },
            bubbles: true,
        }));
    }
    _setError(error) {
        if (this._error === error)
            return;
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-credential:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _setCancelled(cancelled) {
        if (this._cancelled === cancelled)
            return;
        this._cancelled = cancelled;
        this._target.dispatchEvent(new CustomEvent("wcs-credential:cancelled-changed", {
            detail: cancelled,
            bubbles: true,
        }));
    }
    _api() {
        const nav = globalThis.navigator;
        return nav?.credentials;
    }
    // Normalizes a rejection reason to a consistent { name, message } shape,
    // mirroring WorkerCore._normalizeError (packages/worker/src/core/WorkerCore.ts).
    _normalizeError(e) {
        if (e instanceof Error) {
            return { name: e.name, message: e.message };
        }
        return { name: "Error", message: String(e) };
    }
    // Classifies a get()/store() rejection as a user cancellation vs a real
    // failure (docs/credential-tag-design.md §2/§5). For the Credential
    // Management API the browser rejects with `NotAllowedError` when the user
    // dismisses/declines the native account-chooser UI — this is a routine "the
    // user did not pick" outcome, not a platform failure, so it maps to
    // `cancelled` and is kept out of `error`. Note this is `NotAllowedError`,
    // NOT `AbortError`: unlike Web Share/Contact Picker (whose APIs reject with
    // `AbortError` on dismissal), credentials.get()/store() signal user refusal
    // via `NotAllowedError`. Every other name (SecurityError, NetworkError, a
    // programmatic signal abort, etc.) flows to `error`.
    _isCancellation(e) {
        return e?.name === "NotAllowedError";
    }
    /**
     * `get(options)` — v1 scope excludes `publicKey` (WebAuthn). If present, it
     * is stripped and the call surfaces a scope-violation `error` instead of
     * forwarding it to the platform API (which would accidentally support
     * WebAuthn through a side door). `navigator.credentials.get()` does not
     * require a user gesture (unlike Web Share/Fullscreen), so this can be
     * invoked automatically on page load for a "silent sign-in" flow.
     */
    async get(options = {}) {
        if ("publicKey" in options) {
            this._setError({ name: "NotSupportedError", message: "WebAuthn (publicKey) is out of scope for @wcstack/credential v1. Use a dedicated WebAuthn node instead." });
            return null;
        }
        const api = this._api();
        if (!api) {
            this._setError({ message: "Credential Management API is not supported in this browser." });
            return null;
        }
        const gen = ++this._gen;
        this._setLoading(true);
        // Reset the previous outcome before starting a new get so a stale
        // cancelled/error does not linger into this call's result.
        this._setError(null);
        this._setCancelled(false);
        try {
            const credential = await api.get(options);
            if (gen !== this._gen)
                return null; // stale (dispose() ran while awaiting)
            this._setValue(credential);
            this._setLoading(false);
            return credential;
        }
        catch (e) {
            if (gen !== this._gen)
                return null;
            if (this._isCancellation(e)) {
                this._setCancelled(true);
            }
            else {
                this._setError(this._normalizeError(e));
            }
            this._setLoading(false);
            return null;
        }
    }
    /**
     * `store(credential)` — shares the same single `_gen` as `get()` (see class
     * docs). `navigator.credentials.store()` resolves `Promise<void>` (per
     * `lib.dom.d.ts`) — there is no payload to read off the API, so `value` is
     * synthesized as an echo of the caller's `credential`, mirroring
     * `ShareCore.share()`'s same accommodation for `navigator.share()`.
     *
     * A `PublicKeyCredential` (`type === "public-key"`, WebAuthn) is rejected as a
     * scope violation before touching the platform API — the same v1 boundary
     * `get()` enforces on the `publicKey` option (docs/credential-tag-design.md
     * §3.2), so this node never becomes a WebAuthn store backdoor.
     */
    async store(credential) {
        if (credential?.type === "public-key") {
            this._setError({ name: "NotSupportedError", message: "WebAuthn (publicKey) credentials are out of scope for @wcstack/credential v1. Use a dedicated WebAuthn node instead." });
            return null;
        }
        const api = this._api();
        if (!api) {
            this._setError({ message: "Credential Management API is not supported in this browser." });
            return null;
        }
        const gen = ++this._gen;
        this._setLoading(true);
        // Reset the previous outcome before starting a new store so a stale
        // cancelled/error does not linger into this call's result.
        this._setError(null);
        this._setCancelled(false);
        try {
            await api.store(credential);
            if (gen !== this._gen)
                return null;
            this._setValue(credential);
            this._setLoading(false);
            return credential;
        }
        catch (e) {
            if (gen !== this._gen)
                return null;
            if (this._isCancellation(e)) {
                this._setCancelled(true);
            }
            else {
                this._setError(this._normalizeError(e));
            }
            this._setLoading(false);
            return null;
        }
    }
}

/**
 * `<wcs-credential>` — declarative Credential Management API primitive
 * (password/federated only — see docs/credential-tag-design.md §0 for the
 * WebAuthn scope exclusion).
 *
 * A thin command-only Shell (mirrors `<wcs-share>`): no attributes at all.
 * `get(options)`/`store(credential)`'s arguments are per-call.
 */
class WcsCredential extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...CredentialCore.wcBindable,
        inputs: [],
        // Inherit commands from Core (single source of truth).
        commands: CredentialCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new CredentialCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-credential:loading-changed": (d) => ({ loading: d === true }),
            "wcs-credential:cancelled-changed": (d) => ({ cancelled: d === true }),
            "wcs-credential:error": (d) => ({ error: d != null }),
        });
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
    get(options) {
        return this._core.get(options);
    }
    store(credential) {
        return this._core.store(credential);
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
    if (!customElements.get(config.tagNames.credential)) {
        customElements.define(config.tagNames.credential, WcsCredential);
    }
}

function bootstrapCredential(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { CredentialCore, WcsCredential, bootstrapCredential, getConfig };
//# sourceMappingURL=index.esm.js.map

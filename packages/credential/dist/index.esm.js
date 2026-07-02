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
    _setValue(value) {
        if (this._value === value)
            return;
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
            this._setError({ message: "WebAuthn (publicKey) is out of scope for @wcstack/credential v1. Use a dedicated WebAuthn node instead." });
            return null;
        }
        const api = this._api();
        if (!api) {
            this._setError({ message: "Credential Management API is not supported in this browser." });
            return null;
        }
        const gen = ++this._gen;
        this._setLoading(true);
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
            if (e?.name === "AbortError") {
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
     */
    async store(credential) {
        const api = this._api();
        if (!api) {
            this._setError({ message: "Credential Management API is not supported in this browser." });
            return null;
        }
        const gen = ++this._gen;
        this._setLoading(true);
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
            if (e?.name === "AbortError") {
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
        // Core の commands をそのまま継承（単一情報源）。
        commands: CredentialCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    constructor() {
        super();
        this._core = new CredentialCore(this);
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

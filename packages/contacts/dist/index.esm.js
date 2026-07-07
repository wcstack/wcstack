const _config = {
    tagNames: {
        contacts: "wcs-contacts",
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
// package exports (see exports.ts) — only `getConfig()` (frozen snapshot) is
// surfaced; `setConfig()` is applied internally via `bootstrapContacts()` and is
// not re-exported from the package root — but a deep path import (`.../src/config.js`)
// can still reach and mutate it. Accepted as-is for cross-package consistency: every
// @wcstack package follows this same shape. Use `getConfig()` for a frozen, safe read.
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
 * Headless Contact Picker primitive. A thin, framework-agnostic wrapper around
 * `navigator.contacts.select(properties, options)` exposed through the
 * wc-bindable protocol.
 *
 * This is the same simplified derivative of `FetchCore._doFetch` that
 * `@wcstack/share`'s `ShareCore` establishes (docs/contact-picker-tag-design.md
 * §1): single `_gen` generation guard, same-value-guarded private setters,
 * never-throw try/catch, no `AbortController`/`abort()` — the Contact Picker
 * API accepts no `AbortSignal` and, like the Web Share dialog, the picker is a
 * single system-modal surface (at most one open at a time).
 *
 * The one structural difference from `ShareCore`: `select()` takes **two**
 * positional arguments (`properties`, `options`) rather than one — the first
 * batch-3 member to do so. The command-token argument pass-through
 * (spec-proposal-command-token-arguments.md) does not special-case argument
 * count, so this requires no protocol change.
 */
class ContactsCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "value", event: "wcs-contacts:complete", getter: (e) => e.detail.value },
            { name: "loading", event: "wcs-contacts:loading-changed" },
            { name: "error", event: "wcs-contacts:error" },
            { name: "cancelled", event: "wcs-contacts:cancelled-changed" },
        ],
        commands: [
            { name: "select", async: true },
        ],
    };
    _target;
    _value = null;
    _loading = false;
    _error = null;
    _cancelled = false;
    // Generation guard (§3.4 of the guidelines): bumped ONLY by dispose(). A
    // select() that settles after dispose() has a stale `gen` and MUST NOT
    // write state to a torn-down element. Unlike FetchCore/EyedropperCore,
    // select() itself does NOT bump `_gen` on each call: the archetype
    // (docs/web-share-tag-design.md §2, adopted verbatim by
    // docs/contact-picker-tag-design.md §1) deliberately drops the "a new call
    // supersedes the previous one" plumbing those cores need, because the
    // contact picker is a single system-modal surface (a second concurrent
    // select() rejects with InvalidStateError on its own). Bumping `_gen` per
    // call would instead let a fast-failing second call incorrectly invalidate
    // a still-pending first call's eventual success. Also not bumped on the
    // unsupported early-return — no asynchronous work is started, so there is
    // no generation to protect.
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
    // Lifecycle (§3.5). Select is command-driven with no subscription to
    // establish, so observe() is an idempotent no-op that resolves once ready;
    // dispose() only invalidates any in-flight select() (there is nothing to
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
        this._target.dispatchEvent(new CustomEvent("wcs-contacts:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    _setValue(value) {
        if (this._value === value)
            return;
        this._value = value;
        this._target.dispatchEvent(new CustomEvent("wcs-contacts:complete", {
            detail: { value },
            bubbles: true,
        }));
    }
    _setError(error) {
        if (this._error === error)
            return;
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-contacts:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _setCancelled(cancelled) {
        if (this._cancelled === cancelled)
            return;
        this._cancelled = cancelled;
        this._target.dispatchEvent(new CustomEvent("wcs-contacts:cancelled-changed", {
            detail: cancelled,
            bubbles: true,
        }));
    }
    // API resolution is call-time, never cached (§3.7): lets tests install/remove
    // navigator.contacts freely and lets an unsupported environment (the common
    // case — desktop browsers entirely lack this API) be detected correctly on
    // every call.
    _api() {
        const nav = globalThis.navigator;
        return typeof nav?.contacts?.select === "function" ? nav.contacts.select.bind(nav.contacts) : undefined;
    }
    async select(properties, options) {
        // never-throw + unsupported: resolve API at call time and bail out
        // immediately if absent. No _gen bump — no asynchronous work is started.
        const selectFn = this._api();
        if (!selectFn) {
            this._setError({ message: "Contact Picker API is not supported in this browser." });
            return null;
        }
        // Captured, not bumped (see the `_gen` field docs above): select() does
        // not supersede a prior in-flight call, only dispose() invalidates.
        const gen = this._gen;
        this._setLoading(true);
        // Reset the previous outcome before starting a new select so a stale
        // cancelled/error does not linger into this call's result.
        this._setError(null);
        this._setCancelled(false);
        try {
            const contacts = await selectFn(properties, options);
            // Stale completion (dispose() ran while the picker was open).
            if (gen !== this._gen) {
                return null;
            }
            // `multiple` does not change the result shape — even a single
            // selection resolves to a one-element array (docs/contact-picker-tag-design.md §3).
            this._setValue(contacts);
            this._setLoading(false);
            return contacts;
        }
        catch (e) {
            // Stale completion (dispose() ran while the picker was open).
            if (gen !== this._gen) {
                return null;
            }
            if (e?.name === "AbortError") {
                // The user dismissed the contact picker — a routine cancellation, not
                // a platform failure. Kept out of `error`.
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
 * `<wcs-contacts>` — declarative Contact Picker API primitive.
 *
 * A thin command-only Shell (mirrors `<wcs-share>`): no attributes at all.
 * `select(properties, options)`'s arguments are per-call, not a declarative
 * setting to park on the element ahead of time.
 *
 * **Android Chrome only.** Desktop browsers entirely lack `navigator.contacts`
 * — treat `unsupported` as the default state, not an edge case, in any
 * example or consuming UI.
 */
class WcsContacts extends HTMLElement {
    // SSR (§4.4): observe() completes synchronously, but the Shell still exposes
    // connectedCallbackPromise so the state binder can await it uniformly across
    // all IO nodes before snapshotting.
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...ContactsCore.wcBindable,
        inputs: [],
        // Core の commands をそのまま継承（単一情報源）。
        commands: ContactsCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    constructor() {
        super();
        this._core = new ContactsCore(this);
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
    select(properties, options) {
        return this._core.select(properties, options);
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
    if (!customElements.get(config.tagNames.contacts)) {
        customElements.define(config.tagNames.contacts, WcsContacts);
    }
}

function bootstrapContacts(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { ContactsCore, WcsContacts, bootstrapContacts, getConfig };
//# sourceMappingURL=index.esm.js.map

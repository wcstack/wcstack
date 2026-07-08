const _config = {
    tagNames: {
        network: "wcs-network",
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

const UNSUPPORTED_SNAPSHOT = Object.freeze({
    effectiveType: null,
    downlink: null,
    rtt: null,
    saveData: null,
    supported: false,
});
/**
 * Headless Network Information primitive. A thin, framework-agnostic wrapper
 * around `navigator.connection` exposed through the wc-bindable protocol.
 *
 * Unlike most wcstack IO nodes, this Core needs no `_gen` generation guard
 * (§3.4): subscribing/unsubscribing to `navigator.connection`'s `change` event
 * is fully synchronous, so there is no asynchronous probe whose stale
 * resolution could race a dispose() (docs/network-tag-design.md §5).
 *
 * `navigator.connection` is unimplemented in Firefox/Safari — unsupported is
 * the common case here, not an edge case (docs/network-tag-design.md §0). All
 * four data fields collapse to `null` and `supported` to `false` in that case.
 */
class NetworkCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "effectiveType", event: "wcs-network:change", getter: (e) => e.detail.effectiveType },
            { name: "downlink", event: "wcs-network:change", getter: (e) => e.detail.downlink },
            { name: "rtt", event: "wcs-network:change", getter: (e) => e.detail.rtt },
            { name: "saveData", event: "wcs-network:change", getter: (e) => e.detail.saveData },
            { name: "supported", event: "wcs-network:change", getter: (e) => e.detail.supported },
        ],
        // Pure monitor: navigator.connection has no request()/action method to invoke.
        commands: [],
    };
    _target;
    _snapshot = UNSUPPORTED_SNAPSHOT;
    // The live NetworkInformation object the `change` listener is attached to (kept
    // so dispose() can remove it precisely; not read for anything else).
    _connection = null;
    // True once observe() has attached the live listener (or determined there is
    // nothing to attach to). Guards observe() so a redundant call does not
    // re-subscribe; dispose() resets it so a later observe() resumes cleanly.
    _subscribed = false;
    // SSR (§3.8): no asynchronous probe to await — observe() completes
    // synchronously, so readiness is immediate.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get ready() {
        return this._ready;
    }
    get effectiveType() {
        return this._snapshot.effectiveType;
    }
    get downlink() {
        return this._snapshot.downlink;
    }
    get rtt() {
        return this._snapshot.rtt;
    }
    get saveData() {
        return this._snapshot.saveData;
    }
    get supported() {
        return this._snapshot.supported;
    }
    // Lifecycle (§3.5). Idempotent: a second observe() while already subscribed
    // is a no-op (no double listener, no redundant dispatch). Synchronous overall
    // (no probe to await), so the returned promise is only for API uniformity
    // with other IO nodes.
    observe() {
        if (!this._subscribed) {
            this._subscribed = true;
            const api = this._api();
            if (api) {
                this._connection = api;
                api.addEventListener("change", this._onChange);
            }
            this._apply(this._read());
        }
        return this._ready;
    }
    dispose() {
        this._subscribed = false;
        if (this._connection) {
            this._connection.removeEventListener("change", this._onChange);
            this._connection = null;
        }
    }
    // API resolution is call-time, never cached (§3.7): lets tests install/remove
    // navigator.connection freely and lets an unsupported environment be detected
    // correctly on every observe()/reading.
    _api() {
        const nav = globalThis.navigator;
        return typeof nav !== "undefined" && nav.connection ? nav.connection : undefined;
    }
    _read() {
        const c = this._api();
        if (!c) {
            return UNSUPPORTED_SNAPSHOT;
        }
        return {
            effectiveType: typeof c.effectiveType === "string" ? c.effectiveType : null,
            downlink: typeof c.downlink === "number" ? c.downlink : null,
            rtt: typeof c.rtt === "number" ? c.rtt : null,
            saveData: typeof c.saveData === "boolean" ? c.saveData : null,
            supported: true,
        };
    }
    _onChange = () => {
        this._apply(this._read());
    };
    // Same-value guard (§3.3 MUST): the native `change` event already fires only
    // on a real change, but this Core still verifies field-by-field before
    // dispatching — defense in depth against a browser quirk double-firing
    // `change` with identical values.
    _apply(next) {
        const prev = this._snapshot;
        if (prev.effectiveType === next.effectiveType &&
            prev.downlink === next.downlink &&
            prev.rtt === next.rtt &&
            prev.saveData === next.saveData &&
            prev.supported === next.supported) {
            return;
        }
        this._snapshot = next;
        this._target.dispatchEvent(new CustomEvent("wcs-network:change", {
            detail: next,
            // Family-wide MUST (async-io-node-guidelines.md §3.3): the event bubbles
            // from the Shell element so document-level consumers can delegate.
            bubbles: true,
        }));
    }
}

/**
 * `<wcs-network>` — declarative Network Information API monitor.
 *
 * The smallest Shell in the batch (docs/network-tag-design.md §9): no
 * attributes at all. `navigator.connection` is a single global with nothing to
 * configure, unlike target-based nodes (`intersection`/`resize`) or
 * descriptor-based ones (`permission`).
 */
class WcsNetwork extends HTMLElement {
    // SSR (§4.4): observe() completes synchronously, but the Shell still exposes
    // connectedCallbackPromise so SSR (@wcstack/server render.ts) can await it
    // uniformly across all IO nodes before snapshotting the HTML. Mirrors
    // WcsPermission.connectedCallbackPromise.
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...NetworkCore.wcBindable,
        inputs: [],
        // Core の commands をそのまま継承（単一情報源）。permission と同型。
        commands: NetworkCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new NetworkCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-network:change": (d) => ({
                "save-data": d.saveData === true,
                supported: d.supported === true,
            }),
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
    get effectiveType() {
        return this._core.effectiveType;
    }
    get downlink() {
        return this._core.downlink;
    }
    get rtt() {
        return this._core.rtt;
    }
    get saveData() {
        return this._core.saveData;
    }
    get supported() {
        return this._core.supported;
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
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
    if (!customElements.get(config.tagNames.network)) {
        customElements.define(config.tagNames.network, WcsNetwork);
    }
}

function bootstrapNetwork(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { NetworkCore, WcsNetwork, bootstrapNetwork, getConfig };
//# sourceMappingURL=index.esm.js.map

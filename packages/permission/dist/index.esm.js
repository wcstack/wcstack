const _config = {
    tagNames: {
        permission: "wcs-permission",
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
 * Headless permission-state primitive. A thin, framework-agnostic wrapper around
 * the Permissions API exposed through the wc-bindable protocol.
 *
 * Unlike the other @wcstack IO nodes (geolocation / clipboard / sse / …), the
 * Permissions API is **read-only**: it has `query()` but no standard `request()`.
 * Asking the user for a grant is the job of the feature node (`<wcs-geo>` etc.);
 * this node only *observes*. It is therefore a pure element → state monitor with
 * **no commands** — command-token does not apply, only event-token.
 *
 * The single observable is `state` (`navigator.permissions.query(descriptor)`'s
 * `PermissionState`, or `"unsupported"`), published via the `wcs-permission:change`
 * event. `granted` / `denied` / `prompt` / `unsupported` are convenience booleans
 * derived from that one event (mirroring how GeolocationCore exposes latitude/…
 * from one `wcs-geo:position` event), so a binding like `hidden@granted` works
 * directly. The live `change` event of the PermissionStatus is tracked so a grant
 * flipping in browser settings flows into the declarative state.
 */
class PermissionCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "state", event: "wcs-permission:change" },
            { name: "granted", event: "wcs-permission:change", getter: (e) => e.detail === "granted" },
            { name: "denied", event: "wcs-permission:change", getter: (e) => e.detail === "denied" },
            { name: "prompt", event: "wcs-permission:change", getter: (e) => e.detail === "prompt" },
            { name: "unsupported", event: "wcs-permission:change", getter: (e) => e.detail === "unsupported" },
        ],
        // No commands: the Permissions API is read-only (query-only). See class docs.
        commands: [],
    };
    _target;
    _descriptor = null;
    _state = "prompt";
    // Live PermissionStatus handle (when the Permissions API is available), kept so
    // the `change` listener can be removed on dispose().
    _permissionStatus = null;
    // True once a permission subscription has been (or is being) established, and
    // reset by dispose(). Guards observe() so a reconnect after dispose() re-queries
    // while a redundant observe() on an already-live subscription does not.
    _permissionSubscribed = false;
    // Monotonic id of the current permission query. Bumped by every _initPermission()
    // and by dispose(). Each in-flight query captures its id and, on resolve, bails
    // unless it is still current — so a query superseded by a rapid (synchronous)
    // disconnect→reconnect, or one that resolves after dispose(), never attaches a
    // listener. A plain boolean cannot cover this: dispose()→observe() flips it
    // false→true again, reopening the window for the stale query to slip through.
    _permGen = 0;
    // Resolves once the most recent query settles (or immediately when the API is
    // unsupported). The Shell exposes this as connectedCallbackPromise so SSR can
    // await the first probe before snapshotting the HTML.
    _ready = Promise.resolve();
    constructor(descriptor, target) {
        super();
        this._target = target ?? this;
        // Headless ergonomics: when a descriptor is supplied up front, probe the
        // permission state immediately so observers see the real value before the
        // first read. The Shell passes nothing and drives the first query from
        // connectedCallback via observe(), once the element's attributes resolve.
        if (descriptor) {
            this._descriptor = descriptor;
            this._ready = this._initPermission();
        }
    }
    get state() {
        return this._state;
    }
    get granted() {
        return this._state === "granted";
    }
    get denied() {
        return this._state === "denied";
    }
    get prompt() {
        return this._state === "prompt";
    }
    get unsupported() {
        return this._state === "unsupported";
    }
    /** Resolves once the current (or initial) query settles. */
    get ready() {
        return this._ready;
    }
    // --- State setter with event dispatch ---
    _setState(state) {
        // Same-value guard: `state` is the only stored value and the derived booleans
        // change in lockstep with it, so suppressing identical re-dispatches is safe.
        if (this._state === state)
            return;
        this._state = state;
        this._target.dispatchEvent(new CustomEvent("wcs-permission:change", {
            detail: state,
            bubbles: true,
        }));
    }
    // --- Public API ---
    /**
     * Start observing `descriptor` (e.g. `{ name: "geolocation" }`). Idempotent
     * while already subscribed — calling it again only updates the stored descriptor
     * for a *future* re-subscription; it does **not** re-query, even when called with
     * a different descriptor (the Shell binds at a fixed connect-time descriptor and
     * does not re-query on a `name` change in v1). To switch permission mid-life,
     * dispose() first, then observe() the new descriptor. On the first call, or after
     * a dispose(), it issues the query and subscribes to the live `change` event.
     * Returns a promise that resolves once that query settles, for SSR.
     */
    observe(descriptor) {
        this._descriptor = descriptor;
        if (!this._permissionSubscribed) {
            this._ready = this._initPermission();
        }
        return this._ready;
    }
    /**
     * Detach the live permission `change` listener. Call from the Shell's
     * `disconnectedCallback` so a removed element does not leak the subscription.
     * A later reconnect can re-subscribe via observe().
     *
     * Headless callers (using PermissionCore directly, without the Shell) own this
     * lifecycle themselves: call dispose() when the observer is no longer needed,
     * otherwise the live PermissionStatus `change` listener keeps this instance
     * reachable for as long as the status is alive. dispose() is safe to call when
     * never subscribed and may be paired with a later observe() to resume.
     */
    dispose() {
        this._permissionSubscribed = false;
        // Invalidate any in-flight query so its .then() bails instead of attaching a
        // listener after teardown.
        this._permGen++;
        if (this._permissionStatus) {
            this._permissionStatus.removeEventListener("change", this._onPermissionChange);
            this._permissionStatus = null;
        }
    }
    // --- Internal ---
    _initPermission() {
        // Guard a missing/empty permission name (e.g. a `<wcs-permission>` with no
        // `name` attribute). Such a descriptor would only ever reject at query() and
        // silently fall back to "unsupported", which is hard to diagnose. Short-circuit
        // to "unsupported" without issuing a doomed query so the misconfiguration
        // surfaces deterministically and no listener is attached.
        if (!this._descriptor || !this._descriptor.name) {
            this._setState("unsupported");
            return Promise.resolve();
        }
        // The Permissions API is optional. When absent (or it rejects, e.g. the
        // browser does not accept the requested permission name), report "unsupported"
        // and leave it at that — there is nothing to retry.
        if (typeof navigator === "undefined" || !navigator.permissions || typeof navigator.permissions.query !== "function") {
            // Route through _setState (not a bare assignment) so observers stay in sync
            // with the public state. The same-value guard means no redundant dispatch
            // when the state does not actually change.
            this._setState("unsupported");
            // Intentionally does NOT set _permissionSubscribed: there is no listener to
            // tear down, so a reconnect simply re-probes (idempotent — the same-value
            // guard suppresses any dispatch and no listener is ever attached). Mirrors
            // GeolocationCore's reinitPermission behavior in unsupported environments.
            return Promise.resolve();
        }
        this._permissionSubscribed = true;
        const gen = ++this._permGen;
        // Cast: WcsPermissionDescriptor widens `name` to string (and allows extra
        // descriptor members like userVisibleOnly / sysex) where the lib DOM type
        // expects the PermissionName union.
        return navigator.permissions.query(this._descriptor).then((status) => {
            // Stale resolution: this query was superseded (rapid reconnect) or the
            // element was disposed while it was in flight. Drop it so only the current
            // subscription attaches a listener.
            if (gen !== this._permGen)
                return;
            this._permissionStatus = status;
            this._setState(status.state);
            status.addEventListener("change", this._onPermissionChange);
        }, () => {
            if (gen !== this._permGen)
                return;
            this._setState("unsupported");
        });
    }
    _onPermissionChange = (event) => {
        const status = event.target;
        this._setState(status.state);
    };
}

// Named WcsPermission (not `Permission`) so the class does not shadow any global,
// and to match the <wcs-geo> / <wcs-ws> convention (WcsGeolocation /
// WcsWebSocket). The public export keeps the `WcsPermission` name unchanged.
class WcsPermission extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...PermissionCore.wcBindable,
        // Shell-level settable surface. `name` is the permission name; the descriptor
        // extras `user-visible-only` (push) and `sysex` (midi) are boolean flags that
        // reflect idempotently, so a binding system that writes through
        // inputs[].attribute is safe.
        inputs: [
            { name: "name", attribute: "name" },
            { name: "userVisibleOnly", attribute: "user-visible-only" },
            { name: "sysex", attribute: "sysex" },
        ],
        // No commands: read-only monitor (see PermissionCore). The Permissions API has
        // no request() — acquiring a grant is the feature node's job.
        commands: [],
    };
    // Created in the Shell constructor with no descriptor so the delegated getters
    // work before connect (returning the default "prompt" / false). The actual
    // query is driven from connectedCallback once the element's attributes resolve
    // (programmatically-created elements have no attributes at construction time).
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new PermissionCore(null, this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-permission:change": (d) => ({
                granted: d === "granted",
                denied: d === "denied",
                prompt: d === "prompt",
                unsupported: d === "unsupported",
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
    // --- Attribute accessors ---
    get name() {
        return this.getAttribute("name") ?? "";
    }
    set name(value) {
        this.setAttribute("name", value);
    }
    get userVisibleOnly() {
        return this.hasAttribute("user-visible-only");
    }
    set userVisibleOnly(value) {
        if (value) {
            this.setAttribute("user-visible-only", "");
        }
        else {
            this.removeAttribute("user-visible-only");
        }
    }
    get sysex() {
        return this.hasAttribute("sysex");
    }
    set sysex(value) {
        if (value) {
            this.setAttribute("sysex", "");
        }
        else {
            this.removeAttribute("sysex");
        }
    }
    // --- Core delegated getters ---
    get state() {
        return this._core.state;
    }
    get granted() {
        return this._core.granted;
    }
    get denied() {
        return this._core.denied;
    }
    get prompt() {
        return this._core.prompt;
    }
    get unsupported() {
        return this._core.unsupported;
    }
    // wc-bindable connectedCallbackPromise protocol: resolves once the connect-time
    // query settles, so SSR (@wcstack/server render.ts) waits for the first probe
    // before snapshotting the HTML. Mirrors WcsGeolocation.connectedCallbackPromise.
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // --- Internal ---
    // Build the query descriptor from the current attributes. Only present extras
    // are included so a bare `{ name }` is passed for permissions that take no
    // additional members. The descriptor is fixed at connect time (v1 does not
    // re-query on a `name` change — see README).
    _descriptor() {
        const descriptor = { name: this.name };
        if (this.userVisibleOnly)
            descriptor.userVisibleOnly = true;
        if (this.sysex)
            descriptor.sysex = true;
        return descriptor;
    }
    // --- Lifecycle ---
    connectedCallback() {
        this.style.display = "none";
        // Begin observing (or revive the subscription after a reconnect). The
        // returned promise is held as connectedCallbackPromise for SSR. query() never
        // rejects in a way that escapes — failures surface as the `unsupported`
        // state — so no .catch() is needed.
        this._connectedCallbackPromise = this._core.observe(this._descriptor());
    }
    disconnectedCallback() {
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.permission)) {
        customElements.define(config.tagNames.permission, WcsPermission);
    }
}

function bootstrapPermission(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { PermissionCore, WcsPermission, bootstrapPermission, getConfig };
//# sourceMappingURL=index.esm.js.map

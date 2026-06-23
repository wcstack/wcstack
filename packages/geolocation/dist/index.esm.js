const _config = {
    autoTrigger: true,
    triggerAttribute: "data-geotarget",
    tagNames: {
        geo: "wcs-geo",
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
    if (typeof partialConfig.autoTrigger === "boolean") {
        _config.autoTrigger = partialConfig.autoTrigger;
    }
    if (typeof partialConfig.triggerAttribute === "string") {
        _config.triggerAttribute = partialConfig.triggerAttribute;
    }
    if (partialConfig.tagNames) {
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    frozenConfig = null;
}

/**
 * Headless geolocation primitive. A thin, framework-agnostic wrapper around the
 * Geolocation API exposed through the wc-bindable protocol.
 *
 * It has two phases, mirroring the two distinct shapes of the underlying API:
 * - **one-shot** — `getCurrentPosition()` resolves a single fix (like FetchCore's
 *   one-shot `fetch()`), toggling `loading` around the async call.
 * - **continuous** — `watch()` / `clearWatch()` stream fixes (like TimerCore's
 *   `start()` / `stop()`), toggling the `watching` flag.
 *
 * Every successful fix is published via the single `wcs-geo:position` event;
 * `latitude` / `longitude` / `accuracy` / `coords` / `timestamp` are read from
 * it through getters (mirroring how TimerCore exposes count/elapsed from one
 * `wcs-timer:tick` event), so an observer that binds any of them is notified on
 * every fix.
 *
 * Geolocation also has a permission gate absent from timer/websocket: the
 * `permission` property reflects `navigator.permissions.query({name:
 * "geolocation"})` (`prompt` / `granted` / `denied`, or `unsupported`) and
 * tracks its live `change` event. It is a read-only sensor — there is no
 * element-bound "send" path; element → state only.
 */
class GeolocationCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "position", event: "wcs-geo:position" },
            { name: "latitude", event: "wcs-geo:position", getter: (e) => e.detail.latitude },
            { name: "longitude", event: "wcs-geo:position", getter: (e) => e.detail.longitude },
            { name: "accuracy", event: "wcs-geo:position", getter: (e) => e.detail.accuracy },
            { name: "coords", event: "wcs-geo:position", getter: (e) => e.detail.coords },
            { name: "timestamp", event: "wcs-geo:position", getter: (e) => e.detail.timestamp },
            { name: "watching", event: "wcs-geo:watching-changed" },
            { name: "loading", event: "wcs-geo:loading-changed" },
            { name: "error", event: "wcs-geo:error" },
            { name: "permission", event: "wcs-geo:permission-changed" },
        ],
        commands: [
            { name: "getCurrentPosition", async: true },
            { name: "watch" },
            { name: "clearWatch" },
        ],
    };
    _target;
    _watchId = null;
    _position = null;
    _watching = false;
    _loading = false;
    _error = null;
    _permission = "prompt";
    // Live PermissionStatus handle (when the Permissions API is available), kept
    // so the `change` listener can be removed on dispose().
    _permissionStatus = null;
    // True once a permission subscription has been (or is being) established, and
    // reset by dispose(). Guards reinitPermission() so the first connect after
    // construction does not double-subscribe, while a reconnect after dispose()
    // does re-subscribe.
    _permissionSubscribed = false;
    // Monotonic id of the current permission query. Bumped by every _initPermission()
    // and by dispose(). Each in-flight query captures its id and, on resolve, bails
    // unless it is still current — so a query superseded by a rapid (synchronous)
    // disconnect→reconnect, or one that resolves after dispose(), never attaches a
    // listener. A plain boolean cannot cover this: dispose()→reinit() flips it
    // false→true again, reopening the window for the stale query to slip through.
    _permGen = 0;
    // Monotonic id of the current acquisition lifecycle, bumped only by dispose().
    // Each getCurrentPosition() captures it at start; the async success/error
    // callback bails (no setters, no resolve-side effects) if it is stale, so a
    // one-shot fix that resolves after the element was disconnected does not
    // dispatch wcs-geo:* on a torn-down element. Unlike FetchCore, the Geolocation
    // API has no AbortController, so a generation guard is the only way to neutralize
    // an in-flight one-shot. (watch is already stopped by clearWatch on disconnect.)
    _acqGen = 0;
    // Monotonic id of the current watch lifecycle, bumped by watch(), clearWatch(),
    // and dispose(). Each watch() captures it; both watch callbacks bail if it is
    // stale. Unlike a live `_watchId === null` check, this distinguishes the current
    // watch from a superseded one: a clearWatch()→watch() restart installs a new
    // watchId (non-null), so a queued callback from the previous watch would pass a
    // null-check but fails the generation compare. (The README recommends exactly
    // this restart sequence to reconfigure a watch.)
    _watchGen = 0;
    // Resolves once the most recent permission probe settles (or immediately when
    // the Permissions API is unsupported). The Shell exposes this as
    // connectedCallbackPromise so SSR can await the first probe before snapshotting
    // the HTML. Mirrors PermissionCore._ready.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
        // Probe the permission state up front so observers see the real value
        // (granted/denied/prompt) before the first read, then keep it live.
        this._ready = this._initPermission();
    }
    get position() {
        return this._position;
    }
    get latitude() {
        return this._position ? this._position.latitude : null;
    }
    get longitude() {
        return this._position ? this._position.longitude : null;
    }
    get accuracy() {
        return this._position ? this._position.accuracy : null;
    }
    get coords() {
        return this._position ? this._position.coords : null;
    }
    get timestamp() {
        return this._position ? this._position.timestamp : null;
    }
    get watching() {
        return this._watching;
    }
    get loading() {
        return this._loading;
    }
    get error() {
        return this._error;
    }
    get permission() {
        return this._permission;
    }
    /** Resolves once the first (or most recent) permission probe settles (§3.8). */
    get ready() {
        return this._ready;
    }
    // --- State setters with event dispatch ---
    _setPosition(position) {
        this._position = position;
        this._target.dispatchEvent(new CustomEvent("wcs-geo:position", {
            detail: position,
            bubbles: true,
        }));
    }
    _setWatching(watching) {
        if (this._watching === watching)
            return;
        this._watching = watching;
        this._target.dispatchEvent(new CustomEvent("wcs-geo:watching-changed", {
            detail: watching,
            bubbles: true,
        }));
    }
    _setLoading(loading) {
        if (this._loading === loading)
            return;
        this._loading = loading;
        this._target.dispatchEvent(new CustomEvent("wcs-geo:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    _setError(error) {
        // Same-value guard, like the other setters. Unlike `position` (which has
        // derived getters and so must re-fire even on an identical reference), `error`
        // has no derived state — so suppressing redundant null→null dispatches (e.g.
        // a successful fix clearing an already-null error) avoids spurious events.
        if (this._error === error)
            return;
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-geo:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _setPermission(permission) {
        if (this._permission === permission)
            return;
        this._permission = permission;
        this._target.dispatchEvent(new CustomEvent("wcs-geo:permission-changed", {
            detail: permission,
            bubbles: true,
        }));
    }
    // --- Public API ---
    /**
     * Acquire a single position fix. Resolves once the fix arrives or the request
     * fails — never rejects: failures are surfaced through the `error` property so
     * they flow into the declarative state, symmetrical with FetchCore.
     */
    getCurrentPosition(options = {}) {
        return new Promise((resolve) => {
            if (!this._hasGeolocation()) {
                this._setError(this._unsupportedError());
                resolve();
                return;
            }
            const gen = this._acqGen;
            this._setLoading(true);
            this._setError(null);
            navigator.geolocation.getCurrentPosition((pos) => {
                // Stale: the element was disposed (disconnected) while this fix was in
                // flight. Drop it so a torn-down element never dispatches wcs-geo:*.
                // Still resolve() so any awaiter (e.g. connectedCallbackPromise) settles.
                if (gen !== this._acqGen) {
                    resolve();
                    return;
                }
                // Guard normalization/dispatch so a throw never escapes this browser
                // callback as an unhandled rejection, leaves the promise pending (which
                // would hang SSR's connectedCallbackPromise), or leaves `loading` stuck
                // true. Loading is cleared first so it holds even if a later step throws.
                try {
                    this._setLoading(false);
                    this._setPosition(this._normalizePosition(pos));
                }
                catch {
                    // Surface the unexpected failure as an error so observers are not left
                    // silently stale, then resolve below.
                    this._setError(this._unexpectedError());
                }
                resolve();
            }, (err) => {
                if (gen !== this._acqGen) {
                    resolve();
                    return;
                }
                try {
                    this._setLoading(false);
                    this._setError(this._normalizeError(err));
                }
                catch {
                    this._setError(this._unexpectedError());
                }
                resolve();
            }, options);
        });
    }
    /**
     * Begin continuously watching the position. Idempotent while already
     * watching: a redundant watch() must not register a second `watchPosition`
     * (which would leak the handle and double the fix rate). Reconfiguring is done
     * via clearWatch() + watch().
     */
    watch(options = {}) {
        if (!this._hasGeolocation()) {
            this._setError(this._unsupportedError());
            return;
        }
        if (this._watching)
            return;
        this._setError(null);
        this._setWatching(true);
        // Open a new watch generation so any queued callback from a prior watch
        // (cleared then restarted) is recognized as stale below.
        const wgen = ++this._watchGen;
        this._watchId = navigator.geolocation.watchPosition((pos) => {
            // Stale: this callback belongs to a watch that was cleared (or the element
            // disposed), possibly already superseded by a restart. A live
            // `_watchId === null` check cannot catch the restart case (the new watch
            // re-populates _watchId), so compare the captured generation instead.
            if (wgen !== this._watchGen)
                return;
            // Guard normalization/dispatch so an unexpected throw never escapes this
            // browser callback as an unhandled rejection — symmetric with the one-shot
            // path.
            try {
                // A recovered fix clears any prior transient error (e.g. a one-off
                // TIMEOUT) so `error` reflects the current state, not a stale failure.
                // The _setError same-value guard makes this free when error is already
                // null.
                this._setError(null);
                this._setPosition(this._normalizePosition(pos));
            }
            catch {
                this._setError(this._unexpectedError());
            }
        }, (err) => {
            if (wgen !== this._watchGen)
                return;
            // An error does not implicitly release the watch — the watchId stays
            // valid and clearWatch() remains the teardown path — so `watching` is
            // left true to reflect "watch still registered". A terminal error (e.g.
            // PERMISSION_DENIED) is surfaced via the `error` property; callers that
            // want to stop on error can call clearWatch() in response.
            try {
                this._setError(this._normalizeError(err));
            }
            catch {
                this._setError(this._unexpectedError());
            }
        }, options);
    }
    clearWatch() {
        if (this._watchId !== null) {
            navigator.geolocation.clearWatch(this._watchId);
            this._watchId = null;
        }
        // Invalidate the current watch generation so any callback the browser may
        // still deliver after teardown bails.
        this._watchGen++;
        this._setWatching(false);
    }
    /**
     * Establish permission monitoring (§3.5). Idempotent: a no-op while a
     * subscription is already live (so the first connect after construction does
     * not double-subscribe), and re-subscribes after a dispose() — e.g. the Shell
     * element was disconnected and then reconnected (reparented). Returns the
     * `ready` promise, which resolves once the (re)established probe settles, so
     * the Shell can expose it as connectedCallbackPromise for SSR. Position
     * acquisition (one-shot / watch) is command-driven and the Shell drives it
     * separately from connectedCallback.
     */
    observe() {
        if (!this._permissionSubscribed) {
            this._ready = this._initPermission();
        }
        return this._ready;
    }
    /**
     * Re-establish the permission `change` subscription after a dispose() — e.g.
     * the Shell element was disconnected and then reconnected (reparented). No-op
     * while a subscription is already live, so the first connect after
     * construction does not double-subscribe. This keeps permission tracking
     * symmetric with position acquisition, which the Shell also revives on
     * reconnect.
     *
     * Retained as a thin alias of observe() for the Shell's existing reconnect
     * path; observe() is the canonical §3.5 lifecycle entry point.
     */
    reinitPermission() {
        void this.observe();
    }
    /**
     * Detach the live permission `change` listener. Call from the Shell's
     * `disconnectedCallback` so a removed element does not leak the subscription.
     * A later reconnect can re-subscribe via reinitPermission().
     */
    dispose() {
        this._permissionSubscribed = false;
        // Invalidate any in-flight query so its .then() bails instead of attaching a
        // listener after teardown.
        this._permGen++;
        // Invalidate any in-flight one-shot acquisition so its success/error callback
        // bails instead of dispatching on a disconnected element.
        this._acqGen++;
        // Likewise invalidate the watch generation. The Shell already calls
        // clearWatch() before dispose(), but a direct headless dispose() (without a
        // preceding clearWatch) still neutralizes any queued watch callback.
        this._watchGen++;
        // Reset the loading shadow silently (no dispatch on a disposed element). The
        // bailed callback above will not clear it, and leaving it true would let the
        // same-value guard swallow the loading=true edge of the next acquisition after
        // a reconnect.
        this._loading = false;
        if (this._permissionStatus) {
            this._permissionStatus.removeEventListener("change", this._onPermissionChange);
            this._permissionStatus = null;
        }
    }
    // --- Internal ---
    _hasGeolocation() {
        return typeof navigator !== "undefined" && !!navigator.geolocation;
    }
    _initPermission() {
        // The Permissions API is optional. When absent (or it rejects, e.g. some
        // browsers don't accept the "geolocation" name), report "unsupported" and
        // leave acquisition to fail loudly via the error property if attempted.
        if (typeof navigator === "undefined" || !navigator.permissions || typeof navigator.permissions.query !== "function") {
            // Route through _setPermission (not a bare assignment) so observers stay in
            // sync with the public state. The same-value guard means no redundant
            // dispatch when the state does not actually change; it does mean a
            // previously-observed "granted"/"denied" being reinit'd into an environment
            // that lost the Permissions API now correctly notifies observers of the
            // unsupported transition instead of silently overwriting the shadow value.
            this._setPermission("unsupported");
            // No asynchronous probe to await: readiness is immediate.
            return Promise.resolve();
        }
        this._permissionSubscribed = true;
        const gen = ++this._permGen;
        return navigator.permissions.query({ name: "geolocation" }).then((status) => {
            // Stale resolution: this query was superseded (rapid reconnect) or the
            // element was disposed while it was in flight. Drop it so only the current
            // subscription attaches a listener.
            if (gen !== this._permGen)
                return;
            this._permissionStatus = status;
            this._setPermission(status.state);
            status.addEventListener("change", this._onPermissionChange);
        }, () => {
            if (gen !== this._permGen)
                return;
            this._setPermission("unsupported");
        });
    }
    _onPermissionChange = (event) => {
        const status = event.target;
        this._setPermission(status.state);
    };
    _normalizePosition(pos) {
        const c = pos.coords;
        const coords = {
            latitude: c.latitude,
            longitude: c.longitude,
            accuracy: c.accuracy,
            altitude: c.altitude,
            altitudeAccuracy: c.altitudeAccuracy,
            heading: c.heading,
            speed: c.speed,
        };
        return { ...coords, timestamp: pos.timestamp, coords };
    }
    _normalizeError(err) {
        return { code: err.code, message: err.message };
    }
    _unsupportedError() {
        // Geolocation API absent: surface it as POSITION_UNAVAILABLE (2) so consumers
        // that switch on the spec error codes treat it like any other unavailable fix.
        return { code: 2, message: "Geolocation API is not available in this environment." };
    }
    _unexpectedError() {
        // An unexpected throw while normalizing/dispatching a fix. Surface it as
        // POSITION_UNAVAILABLE (2) so it flows into `error` like any other failure
        // instead of escaping the browser callback as an unhandled rejection.
        return { code: 2, message: "Unexpected error while processing the position fix." };
    }
}

let registered = false;
function handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element))
        return;
    const triggerElement = target.closest(`[${config.triggerAttribute}]`);
    if (!triggerElement)
        return;
    const geoId = triggerElement.getAttribute(config.triggerAttribute);
    if (!geoId)
        return;
    // Resolve the registered constructor at call time instead of importing
    // Geolocation as a value. The value import created a components/Geolocation.ts
    // ⇄ autoTrigger.ts cycle (Geolocation.connectedCallback() calls
    // registerAutoTrigger()). instanceof against the customElements registry keeps
    // the exact same identity guarantee — only the registered <wcs-geo> class
    // matches — without the import cycle.
    const GeoCtor = customElements.get(config.tagNames.geo);
    const geoElement = document.getElementById(geoId);
    if (!GeoCtor || !(geoElement instanceof GeoCtor))
        return;
    // Suppress the element's default action so a fix can be requested without
    // navigating. Intentional: do not attach data-geotarget to an element whose
    // default action you also want (real <a href> link, form-submit button) — it
    // will be cancelled. See README "Optional DOM Triggering".
    event.preventDefault();
    geoElement.getCurrentPosition();
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

// Named WcsGeolocation (not `Geolocation`) so the class does not shadow the
// global DOM `Geolocation` interface (the type of `navigator.geolocation`), and
// to match the <wcs-ws> convention (WcsWebSocket). The public export keeps the
// `WcsGeolocation` name unchanged, so this rename is non-breaking.
class WcsGeolocation extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...GeolocationCore.wcBindable,
        properties: [
            ...GeolocationCore.wcBindable.properties,
            { name: "trigger", event: "wcs-geo:trigger-changed" },
        ],
        // Shell-level settable surface. Each input carries its mirrored `attribute`
        // hint (boolean flags reflect idempotently, so a binding system that writes
        // through inputs[].attribute is safe), following the <wcs-ws> convention.
        // `trigger` has no attribute — it is a momentary command-property, not a
        // declarative attribute. The `getCurrentPosition` / `watchPosition` /
        // `clearWatch` commands are declared below.
        inputs: [
            { name: "highAccuracy", attribute: "high-accuracy" },
            { name: "timeout", attribute: "timeout" },
            { name: "maximumAge", attribute: "maximum-age" },
            { name: "watch", attribute: "watch" },
            { name: "manual", attribute: "manual" },
            { name: "trigger" },
        ],
        // The Core's `watch` command is renamed to `watchPosition` on the Shell so it
        // does not collide with the `watch` boolean attribute accessor (same pattern
        // as <wcs-ws>, where the `send` command becomes `sendMessage` to free the
        // `send` setter). `getCurrentPosition` / `clearWatch` are unchanged.
        commands: [
            { name: "getCurrentPosition", async: true },
            { name: "watchPosition" },
            { name: "clearWatch" },
        ],
    };
    _core;
    _trigger = false;
    _connectedCallbackPromise = Promise.resolve();
    constructor() {
        super();
        this._core = new GeolocationCore(this);
    }
    // --- Attribute accessors ---
    get highAccuracy() {
        return this.hasAttribute("high-accuracy");
    }
    set highAccuracy(value) {
        if (value) {
            this.setAttribute("high-accuracy", "");
        }
        else {
            this.removeAttribute("high-accuracy");
        }
    }
    get timeout() {
        const attr = this.getAttribute("timeout");
        if (attr === null || attr.trim() === "")
            return Infinity;
        // Strict parse via Number() (unlike parseInt, "10px" -> NaN, not 10). Fall
        // back to the API default (Infinity = no timeout) for any non-finite or
        // negative value, matching the README "invalid values fall back to default".
        const parsed = Number(attr);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : Infinity;
    }
    set timeout(value) {
        this.setAttribute("timeout", String(value));
    }
    get maximumAge() {
        const attr = this.getAttribute("maximum-age");
        if (attr === null || attr.trim() === "")
            return 0;
        // Strict parse via Number() (unlike parseInt, "10px" -> NaN, not 10). Fall
        // back to the API default (0 = never use a cached fix) for any non-finite or
        // negative value, matching the README "invalid values fall back to default".
        const parsed = Number(attr);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    }
    set maximumAge(value) {
        this.setAttribute("maximum-age", String(value));
    }
    get watch() {
        return this.hasAttribute("watch");
    }
    set watch(value) {
        if (value) {
            this.setAttribute("watch", "");
        }
        else {
            this.removeAttribute("watch");
        }
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
    get position() {
        return this._core.position;
    }
    get latitude() {
        return this._core.latitude;
    }
    get longitude() {
        return this._core.longitude;
    }
    get accuracy() {
        return this._core.accuracy;
    }
    get coords() {
        return this._core.coords;
    }
    get timestamp() {
        return this._core.timestamp;
    }
    get watching() {
        return this._core.watching;
    }
    get loading() {
        return this._core.loading;
    }
    get error() {
        return this._core.error;
    }
    get permission() {
        return this._core.permission;
    }
    // wc-bindable connectedCallbackPromise protocol: resolves once the connect-time
    // acquisition settles, so SSR (@wcstack/server render.ts) waits for the first
    // fix before snapshotting the HTML. Mirrors Fetch.connectedCallbackPromise. In
    // `watch` / `manual` modes there is no one-shot connect-time fix to await, so it
    // stays the default resolved promise.
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // --- Command property ---
    get trigger() {
        return this._trigger;
    }
    set trigger(value) {
        // Momentary command-property: a false→true write requests a single fix.
        // Mirrors the trigger flag on <wcs-timer> / <wcs-ws>. Prefer the
        // command-token protocol (`command.getCurrentPosition: $command.locate`) for
        // state-driven acquisition; this exists mainly for the DOM click trigger and
        // simple boolean bindings.
        const v = !!value;
        if (v) {
            this._trigger = true;
            // Fire-and-forget: getCurrentPosition() never rejects (failures surface via
            // the `error` property), so the returned promise is intentionally dropped.
            void this.getCurrentPosition();
            this._trigger = false;
            this.dispatchEvent(new CustomEvent("wcs-geo:trigger-changed", {
                detail: false,
                bubbles: true,
            }));
        }
    }
    // --- Commands ---
    getCurrentPosition() {
        return this._core.getCurrentPosition(this._options());
    }
    watchPosition() {
        this._core.watch(this._options());
    }
    clearWatch() {
        this._core.clearWatch();
    }
    // --- Internal ---
    _options() {
        return {
            enableHighAccuracy: this.highAccuracy,
            timeout: this.timeout,
            maximumAge: this.maximumAge,
        };
    }
    // --- Lifecycle ---
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        // Revive permission tracking after a reconnect (reparenting). No-op on the
        // first connect since the constructor already subscribed; only re-subscribes
        // when disconnectedCallback's dispose() tore the subscription down.
        this._core.reinitPermission();
        if (!this.manual) {
            // `watch` attribute selects the default phase: continuous monitoring vs a
            // single fix on connect.
            if (this.watch) {
                this.watchPosition();
            }
            else {
                // Track only the one-shot connect-time fix so SSR can await it. watch /
                // manual leave the promise at its resolved default. getCurrentPosition()
                // never rejects (failures surface via `error`), so no .catch() is needed.
                this._connectedCallbackPromise = this.getCurrentPosition();
            }
        }
    }
    disconnectedCallback() {
        this._core.clearWatch();
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.geo)) {
        customElements.define(config.tagNames.geo, WcsGeolocation);
    }
}

function bootstrapGeolocation(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { GeolocationCore, WcsGeolocation, bootstrapGeolocation, getConfig };
//# sourceMappingURL=index.esm.js.map

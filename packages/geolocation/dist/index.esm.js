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
/** A misspelt option would otherwise do nothing: `bootstrapGeolocation` refuses it. */
function invalid(key) {
    throw new Error(`[@wcstack/geolocation] bootstrapGeolocation: "${key}" is not one of its options, or not of the option's type.`);
}
/**
 * Applies the options given; an undefined value is left out. An option this package does not
 * have, a value of another type than its default (null, or an array for an object, included) or
 * a tag name it does not define throws, and then nothing is applied.
 */
function setConfig(partialConfig) {
    const options = _config;
    const tags = _config.tagNames;
    const given = Object.entries(partialConfig).filter(([, value]) => value !== undefined);
    const givenTags = Object.entries(partialConfig.tagNames ?? {}).filter(([, tag]) => tag !== undefined);
    for (const [key, value] of given) {
        const current = options[key];
        if (!Object.hasOwn(options, key) || value === null || typeof value !== typeof current || Array.isArray(value) !== Array.isArray(current)) {
            invalid(key);
        }
    }
    for (const [name, tag] of givenTags) {
        if (!Object.hasOwn(tags, name) || typeof tag !== "string")
            invalid(`tagNames.${name}`);
    }
    for (const [key, value] of given) {
        if (key !== "tagNames") {
            options[key] = value;
        }
    }
    for (const [name, tag] of givenTags)
        tags[name] = tag;
    frozenConfig = null;
}

var pkg = {"name":"@wcstack/geolocation","version":"4.12.0"};

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /io-core/platform-capability.ts by scripts/sync-io-core.mjs.
// Run `node scripts/sync-io-core.mjs` after editing the source.
// ===========================================================================
/** Permissions-Policy が制御する機能(permission 名と同じ文字列)。 */
const POLICY_CONTROLLED = new Set([
    "camera", "microphone", "geolocation", "midi", "clipboard-read", "clipboard-write",
    "screen-wake-lock", "idle-detection", "accelerometer", "gyroscope", "magnetometer",
    "ambient-light-sensor", "display-capture",
]);
function featureUnavailable(feature) {
    const g = globalThis;
    if (g.isSecureContext === false)
        return "insecure-context";
    if (!POLICY_CONTROLLED.has(feature))
        return null;
    const policy = g.document?.permissionsPolicy ?? g.document?.featurePolicy;
    if (policy === undefined || typeof policy.allowsFeature !== "function")
        return null;
    try {
        return policy.allowsFeature(feature) ? null : "policy-blocked";
    }
    catch {
        return null;
    }
}
/** `featureUnavailable` の理由を、作者が直し方を読める文にする。`what` は文頭(「The camera」など)。 */
function featureUnavailableMessage(what, feature, reason) {
    return reason === "insecure-context"
        ? `${what} needs a secure context (https:, or http://localhost), and this page is not one.`
        : `${what} is turned off for this page by a Permissions-Policy: the server's Permissions-Policy header, ` +
            `or an <iframe> without allow="${feature}". The browser's site settings cannot change that.`;
}

/**
 * geolocationCapabilities.ts
 *
 * Geolocation node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。geolocation は concurrent-independent(競合しない)ため lane は持たず、
 * error taxonomy(errorInfo)のみを採用する。
 */
/** 安定した geolocation error code(taxonomy)。値は公開キーとして固定。 */
const WCS_GEO_ERROR_CODE = {
    PermissionDenied: "permission-denied",
    PositionUnavailable: "position-unavailable",
    Timeout: "timeout",
    // このページで使えない(API 不在・安全でない origin・Permissions-Policy)。利用者の拒否
    // (permission-denied)と区別する — サイトの設定では直らない。
    CapabilityMissing: "capability-missing",
};
/**
 * 正規化済み `GeolocationPositionError`(spec code 1/2/3)を serializable な error
 * taxonomy に写す。"unexpected" は code 2(position-unavailable)に畳むため、これは既存の
 * `error.code` を忠実にミラーする。permission-denied(1)だけは retry で回復しないため
 * recoverable=false。`unsupported`(このページで使えない — Core は `error.code` を 2 にする)
 * は capability-missing / probe / recoverable=false。
 */
function deriveGeoErrorInfo(code, message, unsupported = false) {
    if (unsupported) {
        return { code: WCS_GEO_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
    }
    const taxonomyCode = code === 1
        ? WCS_GEO_ERROR_CODE.PermissionDenied
        : code === 3
            ? WCS_GEO_ERROR_CODE.Timeout
            : WCS_GEO_ERROR_CODE.PositionUnavailable;
    return { code: taxonomyCode, phase: "execute", recoverable: code !== 1, message };
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
            { name: "position", event: "wcs-geo:position", semantics: "state" },
            { name: "latitude", event: "wcs-geo:position", semantics: "state", getter: (e) => e.detail.latitude },
            { name: "longitude", event: "wcs-geo:position", semantics: "state", getter: (e) => e.detail.longitude },
            { name: "accuracy", event: "wcs-geo:position", semantics: "state", getter: (e) => e.detail.accuracy },
            { name: "coords", event: "wcs-geo:position", semantics: "state", getter: (e) => e.detail.coords },
            { name: "timestamp", event: "wcs-geo:position", semantics: "state", getter: (e) => e.detail.timestamp },
            { name: "watching", event: "wcs-geo:watching-changed", semantics: "state" },
            { name: "loading", event: "wcs-geo:loading-changed", semantics: "state" },
            { name: "error", event: "wcs-geo:error", semantics: "state" },
            { name: "permission", event: "wcs-geo:permission-changed", semantics: "state" },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output derived from the normalized `error` (spec code
            // 1/2/3 → permission-denied / position-unavailable / timeout); the existing
            // `error` property/event are unchanged. Fires `wcs-geo:error-info-changed`.
            { name: "errorInfo", event: "wcs-geo:error-info-changed", semantics: "state" },
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
    _errorInfo = null;
    // the errors that say this page cannot use geolocation (errorInfo: capability-missing)
    _unsupportedErrors = new WeakSet();
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
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Exposed as an additive wc-bindable property (event
     * `wcs-geo:error-info-changed`), derived from the normalized `error`; the
     * existing `error` property/event are unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
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
        // Keep the additive `errorInfo` taxonomy in sync with `error`: derive it from
        // the normalized error (or null on clear). Fires before the `error` event so an
        // observer binding both sees the classification first, mirroring the io-node
        // family. No lane here — geolocation's fixes don't compete (dispose-only guard).
        this._commitErrorInfo(error === null ? null : deriveGeoErrorInfo(error.code, error.message, this._unsupportedErrors.has(error)));
        this._target.dispatchEvent(new CustomEvent("wcs-geo:error", {
            detail: error,
            bubbles: true,
        }));
    }
    // Called only from _setError (which already same-value-guards on the error
    // reference), so errorInfo transitions exactly when error does — no separate
    // guard needed here.
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-geo:error-info-changed", {
            detail: info,
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
        // Clear loading, with its event (timing-and-firing-contract §22): the bailed
        // callback above will not clear it, and a route the element leaves keeps its
        // nodes — bindings included — for the next entry, so a reset nobody heard would
        // leave the page showing an acquisition that is gone. Clearing it also keeps the
        // loading=true edge of the next acquisition after a reconnect.
        this._setLoading(false);
        if (this._permissionStatus) {
            this._permissionStatus.removeEventListener("change", this._onPermissionChange);
            this._permissionStatus = null;
        }
    }
    // --- Internal ---
    _hasGeolocation() {
        return typeof navigator !== "undefined" && !!navigator.geolocation && featureUnavailable("geolocation") === null;
    }
    _initPermission() {
        // A page that cannot use geolocation (not a secure context, or turned off by a
        // Permissions-Policy) is "unsupported": the Permissions API answers "granted" in a
        // policy-blocked frame and "denied" on an insecure origin — a user's refusal, which
        // the site settings would fix and these cannot. Neither changes while the page lives.
        if (featureUnavailable("geolocation") !== null) {
            this._setPermission("unsupported");
            return Promise.resolve();
        }
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
        // Geolocation API absent, or not available to this page: surface it as
        // POSITION_UNAVAILABLE (2) so consumers that switch on the spec error codes treat
        // it like any other unavailable fix; errorInfo says capability-missing.
        const reason = featureUnavailable("geolocation");
        const error = {
            code: 2,
            message: reason === null
                ? "Geolocation API is not available in this environment."
                : featureUnavailableMessage("Geolocation", "geolocation", reason),
        };
        this._unsupportedErrors.add(error);
        return error;
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

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/upgrade-properties.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
function hasAccessorOnPrototype(target, name) {
    let proto = Object.getPrototypeOf(target);
    while (proto !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (descriptor !== undefined) {
            return typeof descriptor.get === "function" || typeof descriptor.set === "function";
        }
        proto = Object.getPrototypeOf(proto);
    }
    return false;
}
// 属性になってしまったオブジェクトの入力（`files="[object File]"`）を、要素ごとに 1 回だけ言う。
// React 19 は定義前の要素にプロパティが無いのでオブジェクトを属性に書き、Vue の `.attr` も
// 書く。要素はその入力をプロパティでしか読まないので、何も受け取らず、何も言わなかった
// （docs/seam-apps.md、fw-inventory）。
const toldObjectAttribute = new WeakSet();
function warnObjectAttribute(element, name, value) {
    if (toldObjectAttribute.has(element))
        return;
    toldObjectAttribute.add(element);
    const tag = element.localName ?? "element";
    console.warn(`[wcs/input-as-attribute] <${tag}> has the attribute ${name}="${value}": an object was written as an ` +
        `attribute, so the element did not receive it. A framework does that when the property is set before the ` +
        `element's definition loads (React 19), or when told to (Vue's .attr). Load the definition before rendering, ` +
        `or assign the property through a ref (Vue: .prop). (Said once per element.)`, element);
}
/**
 * `connectedCallback` の先頭で呼ぶ。宣言済み input のうち upgrade 前の代入で
 * accessor をシャドウしている own プロパティを、delete → 再代入で setter に通し直す。
 *
 * - 冪等: 再代入は accessor を通るので own プロパティは残らず、2 回目以降は no-op。
 * - 宣言に `inputs` が無い要素、`wcBindable` を持たない要素では何もしない。
 * - 値の意味は変えない。今まで捨てられていた代入が届くようになる一方向の変化。
 * - 値が `[object …]` の属性（属性に書かれてしまったオブジェクトの入力）は、要素ごとに 1 回警告する。
 */
function upgradeProperties(element) {
    const declaration = element.constructor?.wcBindable;
    const inputs = declaration?.inputs;
    if (inputs === undefined)
        return;
    const getAttribute = element.getAttribute;
    for (const input of inputs) {
        const name = input.name;
        const attribute = typeof getAttribute === "function" ? getAttribute.call(element, name.toLowerCase()) : null;
        if (attribute !== null && attribute.startsWith("[object "))
            warnObjectAttribute(element, name, attribute);
        if (!Object.prototype.hasOwnProperty.call(element, name))
            continue;
        if (!hasAccessorOnPrototype(element, name))
            continue;
        const record = element;
        const value = record[name];
        delete record[name];
        record[name] = value;
    }
}

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/input-attribute.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
// 属性へ反映する wc-bindable 入力の producer 側（SPEC-extensions § Producer guidance for inputs の P1〜P3）。
// 入力の setter は属性をこの 2 関数で書く。それで次が揃う:
//   - `undefined` は「値が無い」（P1）: 属性を、この関数で最初に書く前の状態 — マークアップに書かれた値、
//     無ければ属性なし（= その入力の文書化した既定値）— へ戻す。applier プロファイルを宣言する binder は
//     値の後の `undefined` を書き（A2）、React 19 も書き、直接の代入でも届く。
//   - `null` はクリア（P2）: 属性なし、つまり文書化した既定値。
//   - どちらも文字列 "undefined" / "null" として属性に入らない。
//
// 「最初に書く前」は、その最初の書き込みのときに読む（遅延）。upgrade 前に代入されたプロパティは
// connectedCallback の upgradeProperties() が通し直すので、そのときにはパーサが書いた属性が揃っている。
// 要素自身が setter を通さずに書いた属性は、最初の書き込みより前なら「最初の状態」に含まれる。
//
// SINGLE SOURCE OF TRUTH: edit only this file (/protocol/input-attribute.ts), then run
// `node scripts/sync-protocol-types.mjs` to regenerate the per-package copies
// (packages/<pkg>/src/protocol/inputAttribute.ts). Those copies are generated — do not edit them.
const initialAttributes = new WeakMap();
/** The attribute as it stood before the first write through these helpers. */
function initialAttribute(el, name) {
    let byName = initialAttributes.get(el);
    if (byName === undefined) {
        byName = new Map();
        initialAttributes.set(el, byName);
    }
    if (!byName.has(name))
        byName.set(name, el.getAttribute(name));
    return byName.get(name);
}
function writeAttribute(el, name, value) {
    if (value === null)
        el.removeAttribute(name);
    else
        el.setAttribute(name, value);
}
/**
 * A value attribute. `value` is written as `String(value)`; `null` removes the attribute;
 * `undefined` restores the attribute the element started with.
 */
function reflectAttribute(el, name, value) {
    const initial = initialAttribute(el, name);
    writeAttribute(el, name, value === undefined ? initial : value === null ? null : String(value));
}
/**
 * A boolean attribute, present while `value` is truthy (`null` and `false` remove it);
 * `undefined` restores the attribute the element started with.
 */
function reflectBooleanAttribute(el, name, value) {
    const initial = initialAttribute(el, name);
    writeAttribute(el, name, value === undefined ? initial : value ? "" : null);
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
            { name: "trigger", event: "wcs-geo:trigger-changed", semantics: "state" },
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
    // connectedCallback が張った connectedCallbackPromise を解く関数。接続時の判断を下す
    // _scheduleLocate のマイクロタスクが（その前に外れたときは disconnectedCallback が）呼ぶ。
    _connectResolve = null;
    // _scheduleLocate のマイクロタスクが待っている間 true
    _locatePending = false;
    // 接続時の判断待ちに clearWatch() が呼ばれたら true — その判断は watch でも監視を始めない
    _watchCancelled = false;
    _internals = null;
    constructor() {
        super();
        this._core = new GeolocationCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-geo:watching-changed": (d) => ({ watching: d === true }),
            "wcs-geo:loading-changed": (d) => ({ loading: d === true }),
            "wcs-geo:error": (d) => ({ error: d != null }),
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
        // never-throw (docs/custom-state-reflection-design.md §3.4): attachInternals
        // is absent in happy-dom / older environments, and pre-125 Chromium rejects
        // non-dashed state names from states.add() (probed and discarded here).
        // Either case silently disables reflection — the component still works, it
        // just doesn't expose :state() selectors.
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
    // Input setters never let setAttribute stringify null / undefined (an
    // "undefined" timeout would silently fall back to Infinity): `null` removes the
    // attribute (the default), `undefined` restores the attribute the element
    // started with (wc-bindable producer guidance P1; React 19 and a direct
    // assignment deliver it, @wcstack/state does not).
    get highAccuracy() {
        return this.hasAttribute("high-accuracy");
    }
    set highAccuracy(value) {
        reflectBooleanAttribute(this, "high-accuracy", value);
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
        reflectAttribute(this, "timeout", value);
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
        reflectAttribute(this, "maximum-age", value);
    }
    get watch() {
        return this.hasAttribute("watch");
    }
    set watch(value) {
        reflectBooleanAttribute(this, "watch", value);
    }
    get manual() {
        return this.hasAttribute("manual");
    }
    set manual(value) {
        reflectBooleanAttribute(this, "manual", value);
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
    get errorInfo() {
        return this._core.errorInfo;
    }
    get permission() {
        return this._core.permission;
    }
    // wc-bindable connectedCallbackPromise protocol: resolves once the connect-time
    // acquisition settles, so SSR (@wcstack/server render.ts) waits for the first
    // fix before snapshotting the HTML. Mirrors Fetch.connectedCallbackPromise. The
    // connect-time decision runs in a microtask (_scheduleLocate), so the promise is
    // armed in connectedCallback and settled there; in `watch` / `manual` modes there
    // is no one-shot connect-time fix to await, so it resolves once the decision ran.
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
        // 接続時の判断待ちなら、その連続監視を取り消す — 同じタスクの append → clearWatch() で、
        // 後のマイクロタスクが監視を始めないように（判断が同期だった頃は、始めた監視を
        // clearWatch() が止めていた）。一発取得は以前と同じく取り消さない。入れ直せば、次の
        // 判断は watch に従う
        if (this._connectResolve !== null)
            this._watchCancelled = true;
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
    // 接続時の取得の判断はマイクロタスクで、そのときの manual / watch / high-accuracy /
    // timeout / maximum-age で 1 回だけ行う（timing-and-firing-contract §23）。router は遷移で
    // 同じノードを入れ直し、新しいルートの params から state が入力を書くのはマイクロタスク —
    // その場で取得すると、前の入力で getCurrentPosition / watchPosition を起こしていた
    // （docs/seam-apps.md、shift-desk）。
    _scheduleLocate() {
        if (this._locatePending)
            return;
        this._locatePending = true;
        queueMicrotask(() => {
            this._locatePending = false;
            const resolveConnect = this._connectResolve;
            this._connectResolve = null;
            // 判断の前に外れた要素は何もしない（disconnectedCallback が解いて null にした）
            if (resolveConnect === null)
                return;
            const watchCancelled = this._watchCancelled;
            this._watchCancelled = false;
            if (this.manual) {
                resolveConnect();
            }
            else if (this.watch) {
                // `watch` attribute selects the default phase: continuous monitoring vs a
                // single fix on connect. 判断待ちに clearWatch() が呼ばれていたら始めない
                if (!watchCancelled)
                    this.watchPosition();
                resolveConnect();
            }
            else {
                // Track only the one-shot connect-time fix so SSR can await it.
                // getCurrentPosition() never rejects (failures surface via `error`), so no
                // .catch() is needed.
                resolveConnect(this.getCurrentPosition());
            }
        });
    }
    connectedCallback() {
        // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
        upgradeProperties(this);
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        // Revive permission tracking after a reconnect (reparenting). No-op on the
        // first connect since the constructor already subscribed; only re-subscribes
        // when disconnectedCallback's dispose() tore the subscription down. It reads no
        // input, so it stays here; only the acquisition decision is deferred.
        this._core.reinitPermission();
        // connectedCallbackPromise は接続時の判断（と一発取得）が済むまでを表す。判断は
        // マイクロタスクなので、ここで張って _scheduleLocate で解く
        this._connectedCallbackPromise = new Promise((resolve) => {
            this._connectResolve = resolve;
        });
        this._scheduleLocate();
    }
    disconnectedCallback() {
        // 判断の前に外れたら、張った connectedCallbackPromise をここで解く — 同じタスクで
        // 入れ直されると次の connectedCallback が張り替えるので、待つ側が取り残されないように
        this._connectResolve?.();
        this._connectResolve = null;
        this._watchCancelled = false;
        this._core.clearWatch();
        this._core.dispose();
    }
}

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/define-element.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
/**
 * One copy of each package on a page (docs/timing-and-firing-contract.md §24). The first copy the
 * page evaluates defines the tags and a second one does nothing, so a copy that finds its tag defined
 * by another copy of the package — not its class, not a subclass of it, not the same version — warns
 * `[wcs/package-twice]` once per registry, naming both versions. The classes it defines carry
 * `"<package>@<version>"` under `Symbol.for("wcstack.package")`; a class without it is named
 * "another copy of <package> that does not name its version" (an older copy, or one loaded through
 * an entry that does not stamp).
 */
/** The static a class defined through this helper carries: `"@wcstack/fetch@<version>"`. */
const PACKAGE_STAMP = Symbol.for("wcstack.package");
/** The registries this copy warned about: one warning per package per registry. */
const warned = new WeakSet();
/**
 * Marks `cls` as defined by `pkg` (`"@wcstack/fetch@<version>"`). A subclass inherits the mark, and
 * `defineProperty` writes it even where a parent's mark is read-only.
 */
function stampPackage(cls, pkg) {
    Object.defineProperty(cls, PACKAGE_STAMP, { value: pkg, configurable: true });
}
/**
 * Warns when `tag` is defined as `existing` by another copy of the package `pkg` names: `existing`
 * is neither `own` nor a subclass of it (omit `own` when the copy has no class to compare with), and
 * carries another version or none. Once per registry.
 */
function warnIfAnotherCopy(registry, tag, existing, own, pkg) {
    if (own !== undefined && (existing === own || existing.prototype instanceof own))
        return;
    const theirs = existing[PACKAGE_STAMP];
    if (theirs === pkg || warned.has(registry))
        return;
    warned.add(registry);
    const name = pkg.slice(0, pkg.lastIndexOf("@"));
    console.warn(`[${name}] [wcs/package-twice] <${tag}> is already defined by ` +
        `${theirs ?? `another copy of ${name} that does not name its version`}; ` +
        `this copy, ${pkg}, does nothing. Load each package once.`);
}
/**
 * Defines each `[tag, class]` in `registry` unless the tag is already defined, stamping the class
 * with `pkg` (`"@wcstack/fetch@<version>"`). A tag another copy of the package defined first is left
 * as it is, with the warning above.
 */
function defineElements(registry, pkg, definitions) {
    for (const [tag, cls] of definitions) {
        const existing = registry.get(tag);
        if (existing === undefined) {
            stampPackage(cls, pkg);
            registry.define(tag, cls);
        }
        else {
            warnIfAnotherCopy(registry, tag, existing, cls, pkg);
        }
    }
}

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
function registerComponents(registry = customElements) {
    defineElements(registry, `${pkg.name}@${pkg.version}`, [
        [config.tagNames.geo, WcsGeolocation],
    ]);
}

function bootstrapGeolocation(userConfig, registry) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents(registry);
}

export { GeolocationCore, WCS_GEO_ERROR_CODE, WcsGeolocation, bootstrapGeolocation, getConfig };
//# sourceMappingURL=index.esm.js.map

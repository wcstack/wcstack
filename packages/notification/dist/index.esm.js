const _config = {
    autoTrigger: true,
    triggerAttribute: "data-notifytarget",
    tagNames: {
        notify: "wcs-notify",
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
// Internal, mutable live config used by the components/autoTrigger (they read it
// at call time so setConfig() takes effect without re-import). Typed as the
// readonly IConfig at the export boundary — the `as IConfig` is a compile-time
// view only and does NOT freeze the object, so this export must stay
// package-internal (it is not re-exported from exports.ts). Public consumers get
// the deep-frozen clone from getConfig() instead.
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
 * Headless desktop-notification primitive. A thin, framework-agnostic wrapper
 * around the Notifications API exposed through the wc-bindable protocol.
 *
 * Unlike `@wcstack/permission` (a read-only monitor — the Permissions API has no
 * `request()`), the Notifications API *does* expose `Notification.requestPermission()`,
 * so this node is self-contained: it both **requests/monitors** the permission and
 * **shows** notifications. It is the first @wcstack node where the command-token
 * (show: `notify`) and event-token (`click` / `close` / `show`) directions both
 * live in one tag.
 *
 * - **request()** asks for the `notifications` permission (`Notification.requestPermission`).
 * - **notify(title, options)** shows a notification and returns its identifying tag
 *   (a caller `options.tag`, or a generated `wcs-<n>`). It picks a backend per
 *   `mode`: the `Notification` constructor (desktop) or
 *   `ServiceWorkerRegistration.showNotification()` (mobile). `"auto"` prefers the
 *   constructor and falls back to the SW on a `TypeError`.
 * - **close(tag) / closeAll()** dismiss notifications by tag / all.
 * - Clicks flow back as the `wcs-notify:click` event: directly via the
 *   Notification's `onclick` (constructor), or via the SW helper's
 *   BroadcastChannel/postMessage relay (SW). `permission` mirrors the live grant.
 *
 * Failures never throw: they surface through `error` (and the `unsupported`
 * permission state) so they flow into the declarative state.
 */
class NotificationCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "permission", event: "wcs-notify:permission-change" },
            { name: "granted", event: "wcs-notify:permission-change", getter: (e) => e.detail === "granted" },
            { name: "denied", event: "wcs-notify:permission-change", getter: (e) => e.detail === "denied" },
            { name: "prompt", event: "wcs-notify:permission-change", getter: (e) => e.detail === "prompt" },
            { name: "unsupported", event: "wcs-notify:permission-change", getter: (e) => e.detail === "unsupported" },
            { name: "error", event: "wcs-notify:error" },
            { name: "clicked", event: "wcs-notify:click", getter: (e) => e.detail },
            { name: "closed", event: "wcs-notify:close", getter: (e) => e.detail },
            { name: "shown", event: "wcs-notify:show", getter: (e) => e.detail },
        ],
        commands: [
            { name: "request", async: true },
            { name: "notify" },
            { name: "close" },
            { name: "closeAll" },
        ],
    };
    _target;
    _mode = "auto";
    _permission = "prompt";
    _error = null;
    _lastClick = null;
    _lastClose = null;
    _lastShow = null;
    // Live PermissionStatus (when the Permissions API can query `notifications`),
    // kept so its `change` listener can be removed on dispose().
    _permissionStatus = null;
    // True once a permission subscription has been (or is being) established; reset
    // by dispose(). Guards observe() so a reconnect re-queries while a redundant
    // observe() on a live subscription does not.
    _permissionSubscribed = false;
    // Monotonic id of the current lifecycle. Bumped by every observe() and by
    // dispose(). In-flight async work (permission query, SW show, inbound click)
    // captures it and bails if stale, so a query/click that resolves after a
    // disconnect — or after a rapid disconnect→reconnect — never mutates state or
    // dispatches on a torn-down element.
    _gen = 0;
    // Resolves once the connect-time permission probe settles. The Shell exposes
    // this as connectedCallbackPromise so SSR can await it before snapshotting.
    _ready = Promise.resolve();
    // Counter for auto-assigned tags when the caller omits one.
    _idSeq = 0;
    // Notifications created via the constructor backend, by tag, so close()/closeAll()
    // can dismiss them. The SW backend has no handle (showNotification returns void),
    // so its tags are tracked separately and closed via registration.getNotifications().
    _constructed = new Map();
    _swTags = new Set();
    // Click subscription handles (SW relay).
    _channel = null;
    _serviceWorker = null;
    _clicksSubscribed = false;
    // Per-click ids already handled, to de-dup the two relay transports. FIFO-capped
    // so a long session does not leak; the two transports always arrive in the same
    // tick, so a small cap is ample.
    _seenIds = [];
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get permission() {
        return this._permission;
    }
    get granted() {
        return this._permission === "granted";
    }
    get denied() {
        return this._permission === "denied";
    }
    get prompt() {
        return this._permission === "prompt";
    }
    get unsupported() {
        return this._permission === "unsupported";
    }
    get error() {
        return this._error;
    }
    get clicked() {
        return this._lastClick;
    }
    get closed() {
        return this._lastClose;
    }
    get shown() {
        return this._lastShow;
    }
    /** Resolves once the current (or initial) permission probe settles. */
    get ready() {
        return this._ready;
    }
    // --- State setters with event dispatch ---
    _setPermission(state) {
        if (this._permission === state)
            return;
        this._permission = state;
        this._target.dispatchEvent(new CustomEvent("wcs-notify:permission-change", {
            detail: state,
            bubbles: true,
        }));
    }
    _setError(error) {
        if (this._error === error)
            return;
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-notify:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _emit(kind, detail) {
        if (kind === "click")
            this._lastClick = detail;
        else if (kind === "close")
            this._lastClose = detail;
        else
            this._lastShow = detail;
        this._target.dispatchEvent(new CustomEvent(`wcs-notify:${kind}`, {
            detail,
            bubbles: true,
        }));
    }
    // --- Public API ---
    /**
     * Start observing the `notifications` permission and subscribing to Service
     * Worker click relays. `mode` selects the show backend (default `"auto"`).
     * Idempotent while already subscribed: it only updates the stored mode; to
     * restart, dispose() first. Returns a promise that resolves once the first
     * permission probe settles, for SSR.
     *
     * Headless callers must call observe() to begin; the Shell calls it from
     * connectedCallback once the element's attributes resolve.
     */
    observe(mode = "auto") {
        this._mode = mode;
        if (!this._permissionSubscribed) {
            this._ready = this._initPermission();
            this._subscribeClicks();
        }
        return this._ready;
    }
    /**
     * Ask the user for the `notifications` permission. Resolves to the resulting
     * (normalized) permission state. Never throws: an unavailable API resolves to
     * `"unsupported"`.
     */
    async request() {
        const api = this._api();
        if (!api || typeof api.requestPermission !== "function") {
            this._setPermission("unsupported");
            return this._permission;
        }
        try {
            const result = await api.requestPermission();
            this._setPermission(this._normalize(result));
        }
        catch {
            // Some legacy engines may reject; keep the current state rather than throw.
        }
        return this._permission;
    }
    /**
     * Show a notification. Returns the identifying tag (the caller's `options.tag`,
     * or a generated `wcs-<n>` when omitted). Never throws: when the API is
     * unavailable or the permission is not granted it surfaces an `error` and
     * returns an empty string.
     */
    notify(title, options = {}) {
        if (!this._api()) {
            this._setError(this._err("unsupported", "Notifications API is not available in this environment."));
            return "";
        }
        if (this._permission !== "granted") {
            this._setError(this._err("not-granted", "Notification permission is not granted; call request() first."));
            return "";
        }
        if (typeof title !== "string") {
            this._setError(this._err("invalid-title", "notify() requires a string title."));
            return "";
        }
        const tag = (typeof options.tag === "string" && options.tag !== "") ? options.tag : this._nextId();
        const payload = options.data;
        const data = { __wcsId: tag, payload };
        const backendOptions = { ...options, tag, data };
        this._setError(null);
        this._show(title, backendOptions, tag, payload);
        return tag;
    }
    /** Dismiss the notification(s) with `tag` across both backends. */
    close(tag) {
        if (typeof tag !== "string" || tag === "")
            return;
        const n = this._constructed.get(tag);
        if (n) {
            n.close();
            this._constructed.delete(tag);
        }
        if (this._swTags.has(tag)) {
            this._closeSw(tag);
            this._swTags.delete(tag);
        }
    }
    /**
     * Dismiss every notification this instance has shown. Scoped to this instance's
     * own tags on both backends — the SW path closes each tracked tag individually
     * rather than enumerating the whole origin, so it never dismisses notifications
     * shown by another `<wcs-notify>` or by an unrelated code path.
     */
    closeAll() {
        for (const n of this._constructed.values()) {
            n.close();
        }
        this._constructed.clear();
        for (const tag of this._swTags) {
            this._closeSw(tag);
        }
        this._swTags.clear();
    }
    /**
     * Detach permission and click subscriptions. Open notifications are intentionally
     * **left on screen** (a notification outlives the page that posted it — that is
     * the point); use close()/closeAll() to dismiss. Call from the Shell's
     * disconnectedCallback. A later observe() resumes.
     */
    dispose() {
        this._permissionSubscribed = false;
        this._clicksSubscribed = false;
        this._gen++;
        if (this._permissionStatus) {
            this._permissionStatus.removeEventListener("change", this._onPermissionChange);
            this._permissionStatus = null;
        }
        if (this._channel) {
            this._channel.removeEventListener("message", this._onInbound);
            this._channel.close();
            this._channel = null;
        }
        if (this._serviceWorker) {
            this._serviceWorker.removeEventListener("message", this._onInbound);
            this._serviceWorker = null;
        }
    }
    // --- Internal: permission ---
    _initPermission() {
        const api = this._api();
        if (!api) {
            this._setPermission("unsupported");
            // Intentionally does NOT set _permissionSubscribed: there is no permission
            // listener to tear down, so a reconnect simply re-probes (idempotent — the
            // same-value guard suppresses any redundant dispatch and no listener is ever
            // attached). _subscribeClicks() is re-entered too, but its own
            // _clicksSubscribed guard short-circuits the second pass, so no transport is
            // double-subscribed. Mirrors @wcstack/permission's unsupported path.
            return Promise.resolve();
        }
        this._permissionSubscribed = true;
        // Prefer the Permissions API: it provides a live `change` event. Fall back to
        // the static `Notification.permission` when it is absent or rejects the
        // `notifications` descriptor.
        if (typeof navigator !== "undefined" && navigator.permissions && typeof navigator.permissions.query === "function") {
            const gen = ++this._gen;
            return navigator.permissions.query({ name: "notifications" }).then((status) => {
                if (gen !== this._gen)
                    return;
                this._permissionStatus = status;
                this._setPermission(this._normalize(status.state));
                status.addEventListener("change", this._onPermissionChange);
            }, () => {
                if (gen !== this._gen)
                    return;
                // Permissions API rejected the `notifications` descriptor — fall back to
                // the static `Notification.permission` (api is in scope and non-null here).
                this._setPermission(this._normalize(api.permission));
            });
        }
        // No Permissions API: read the static permission once (no live change events).
        this._setPermission(this._normalize(api.permission));
        return Promise.resolve();
    }
    _onPermissionChange = (event) => {
        const status = event.target;
        this._setPermission(this._normalize(status.state));
    };
    // Normalize the Notifications API's `"default"` to `"prompt"` so this node shares
    // the four-value surface of @wcstack/permission. The Permissions API already
    // reports `"prompt"`, so it passes through unchanged.
    _normalize(raw) {
        if (raw === "default")
            return "prompt";
        if (raw === "granted" || raw === "denied" || raw === "prompt")
            return raw;
        return "prompt";
    }
    // --- Internal: showing ---
    _show(title, options, tag, payload) {
        if (this._mode === "sw") {
            this._showViaSw(title, options, tag, payload);
            return;
        }
        const handled = this._showViaConstructor(title, options, tag, payload);
        if (handled)
            return;
        // Constructor threw TypeError (e.g. mobile, where `new Notification` is illegal).
        if (this._mode === "auto") {
            this._showViaSw(title, options, tag, payload);
        }
        else {
            this._setError(this._err("show-failed", "new Notification() is not usable here and mode=\"constructor\" disallows the Service Worker fallback."));
        }
    }
    // Returns false only when the constructor threw a TypeError (the signal to fall
    // back to the SW backend); true when it showed or surfaced a non-TypeError error.
    _showViaConstructor(title, options, tag, payload) {
        const api = this._api();
        const gen = this._gen;
        let n;
        try {
            n = new api(title, options);
        }
        catch (e) {
            if (e instanceof TypeError)
                return false;
            this._setError(this._err("show-failed", "Failed to create the notification."));
            return true;
        }
        this._constructed.set(tag, n);
        n.onshow = () => {
            if (gen !== this._gen)
                return;
            this._emit("show", { tag, data: payload, action: "" });
        };
        n.onclick = () => {
            if (gen !== this._gen)
                return;
            this._emit("click", { tag, data: payload, action: "" });
        };
        n.onclose = () => {
            this._constructed.delete(tag);
            if (gen !== this._gen)
                return;
            this._emit("close", { tag, data: payload, action: "" });
        };
        n.onerror = () => {
            if (gen !== this._gen)
                return;
            this._setError(this._err("show-failed", "The notification failed to display."));
        };
        return true;
    }
    _showViaSw(title, options, tag, payload) {
        const sw = navigator.serviceWorker;
        if (!sw) {
            this._setError(this._err("no-service-worker", "Service Worker is required to show this notification but is unavailable."));
            return;
        }
        const gen = this._gen;
        this._swTags.add(tag);
        // A notification deliberately outlives the page (see § dispose), so we do NOT
        // bail before showNotification on a stale gen — a notify() issued while
        // connected still shows. The stale-gen guards only suppress dispatching the
        // observable `show` / `error` back onto a torn-down element.
        sw.ready
            .then((registration) => registration.showNotification(title, options))
            .then(() => {
            if (gen !== this._gen)
                return;
            this._emit("show", { tag, data: payload, action: "" });
        })
            .catch(() => {
            if (gen !== this._gen)
                return;
            this._setError(this._err("show-failed", "ServiceWorkerRegistration.showNotification() failed."));
        });
    }
    // Close the SW notification(s) carrying `tag`. Always scoped to a single tag —
    // both callers (close / closeAll) iterate their own tracked tags, so the whole
    // origin is never enumerated.
    _closeSw(tag) {
        const sw = navigator.serviceWorker;
        if (!sw)
            return;
        sw.ready.then((registration) => {
            return registration.getNotifications({ tag }).then((list) => {
                for (const n of list)
                    n.close();
            });
        }).catch(() => {
            // Closing is best-effort; a failure to enumerate is not surfaced.
        });
    }
    // --- Internal: click relay (SW) ---
    _subscribeClicks() {
        if (this._clicksSubscribed)
            return;
        this._clicksSubscribed = true;
        if (typeof BroadcastChannel === "function") {
            this._channel = new BroadcastChannel("wcs-notify");
            this._channel.addEventListener("message", this._onInbound);
        }
        const sw = navigator.serviceWorker;
        if (sw) {
            this._serviceWorker = sw;
            sw.addEventListener("message", this._onInbound);
        }
    }
    _onInbound = (event) => {
        const msg = event.data;
        if (!msg || msg.__wcsNotify !== true)
            return;
        if (this._isDuplicate(msg.id))
            return;
        this._emit("click", { tag: msg.tag, data: this._unwrap(msg.data), action: msg.action });
    };
    _isDuplicate(id) {
        if (this._seenIds.includes(id))
            return true;
        this._seenIds.push(id);
        if (this._seenIds.length > 50)
            this._seenIds.shift();
        return false;
    }
    _unwrap(raw) {
        if (raw !== null && typeof raw === "object" && "__wcsId" in raw) {
            return raw.payload;
        }
        return raw;
    }
    // --- Internal: misc ---
    // Resolve the global `Notification` constructor at call time (not cached) so
    // tests can install/remove it and so unsupported environments report correctly.
    _api() {
        const g = globalThis;
        return typeof g.Notification === "function" ? g.Notification : undefined;
    }
    _nextId() {
        return `wcs-${++this._idSeq}`;
    }
    _err(error, message) {
        return { error, message };
    }
}

let registered = false;
function handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element))
        return;
    // A misconfigured triggerAttribute (e.g. one with a space) makes the attribute
    // selector invalid and closest() throw SyntaxError; guard so a bad config
    // disables only this shortcut rather than killing every document click handler.
    let triggerElement;
    try {
        triggerElement = target.closest(`[${config.triggerAttribute}]`);
    }
    catch {
        return;
    }
    if (!triggerElement)
        return;
    const notifyId = triggerElement.getAttribute(config.triggerAttribute);
    if (!notifyId)
        return;
    // Resolve the registered constructor at call time instead of importing Notify as
    // a value, avoiding a components/Notify.ts ⇄ autoTrigger.ts cycle
    // (Notify.connectedCallback() calls registerAutoTrigger()). instanceof against
    // the customElements registry keeps the same identity guarantee.
    const NotifyCtor = customElements.get(config.tagNames.notify);
    const notifyElement = document.getElementById(notifyId);
    if (!NotifyCtor || !(notifyElement instanceof NotifyCtor))
        return;
    // The title comes from the trigger element: an explicit `data-notifytitle`
    // attribute wins, otherwise the element's trimmed text content. The body is an
    // optional `data-notifybody`. This keeps the click-driven shortcut declarative
    // without inventing a payload channel.
    const explicit = triggerElement.getAttribute("data-notifytitle");
    // `Element.textContent` is spec-guaranteed non-null (only Document / DocumentType
    // nodes return null, never an Element), so the cast is sound and lets us avoid an
    // unreachable `?? ""` branch. `triggerElement` is always an Element here.
    const title = explicit !== null ? explicit : triggerElement.textContent.trim();
    const body = triggerElement.getAttribute("data-notifybody");
    notifyElement.notify(title, body !== null ? { body } : undefined);
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

/**
 * `<wcs-notify>` — declarative desktop notifications. Wraps NotificationCore and
 * exposes both directions in one tag:
 *
 * - **`notice`** (reactive input): writing a *changed* value shows a notification,
 *   suppressing same-value writes so it fires only when the bound source actually
 *   changes. The imperative `notify` command instead shows on demand (even the
 *   same text again). See `docs/notification-tag-design.md` § 2.
 * - **`request` / `notify` / `close` / `closeAll`** commands (state → element).
 * - per-notification options (`body` / `icon` / `badge` / `tag` / `lang` / `dir` /
 *   `require-interaction` / `silent` / `renotify`) as mirrored attributes.
 * - `mode` selects the show backend (`auto` / `sw` / `constructor`).
 * - the Core's observable surface (permission / granted / … / error / clicked /
 *   closed / shown) via delegated getters; clicked/closed/shown carry the
 *   `{ tag, data, action }` payload for event-token wiring.
 */
class WcsNotify extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...NotificationCore.wcBindable,
        // Shell-level settable surface. `notice` is a momentary reactive command-property
        // with no mirrored attribute (it carries dynamic text, not declarative config),
        // mirroring <wcs-speak>'s `say`. The rest mirror their HTML attributes idempotently.
        inputs: [
            { name: "notice" },
            { name: "mode", attribute: "mode" },
            { name: "body", attribute: "body" },
            { name: "icon", attribute: "icon" },
            { name: "badge", attribute: "badge" },
            { name: "tag", attribute: "tag" },
            { name: "lang", attribute: "lang" },
            { name: "dir", attribute: "dir" },
            { name: "requireInteraction", attribute: "require-interaction" },
            { name: "silent", attribute: "silent" },
            { name: "renotify", attribute: "renotify" },
            { name: "manual", attribute: "manual" },
        ],
        commands: NotificationCore.wcBindable.commands,
    };
    _core;
    _notice = "";
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new NotificationCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-notify:permission-change": (d) => ({
                granted: d === "granted", denied: d === "denied",
                prompt: d === "prompt", unsupported: d === "unsupported",
            }),
            "wcs-notify:error": (d) => ({ error: d != null }),
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
    get mode() {
        const m = this.getAttribute("mode");
        return (m === "sw" || m === "constructor") ? m : "auto";
    }
    set mode(value) {
        this.setAttribute("mode", value);
    }
    get body() {
        return this.getAttribute("body") ?? "";
    }
    set body(value) {
        this._reflect("body", value);
    }
    get icon() {
        return this.getAttribute("icon") ?? "";
    }
    set icon(value) {
        this._reflect("icon", value);
    }
    get badge() {
        return this.getAttribute("badge") ?? "";
    }
    set badge(value) {
        this._reflect("badge", value);
    }
    get tag() {
        return this.getAttribute("tag") ?? "";
    }
    set tag(value) {
        this._reflect("tag", value);
    }
    // NOTE: `lang` and `dir` intentionally repurpose the standard HTMLElement IDL
    // attributes as per-notification options (forwarded to NotificationOptions).
    // This element is always display:none, so overriding their normal rendering
    // semantics has no visual effect — but be aware the values mean "the
    // notification's language/direction", not the host element's.
    get lang() {
        return this.getAttribute("lang") ?? "";
    }
    set lang(value) {
        this._reflect("lang", value);
    }
    get dir() {
        return this.getAttribute("dir") ?? "";
    }
    set dir(value) {
        this._reflect("dir", value);
    }
    get requireInteraction() {
        return this.hasAttribute("require-interaction");
    }
    set requireInteraction(value) {
        this._reflectBool("require-interaction", value);
    }
    get silent() {
        return this.hasAttribute("silent");
    }
    set silent(value) {
        this._reflectBool("silent", value);
    }
    get renotify() {
        return this.hasAttribute("renotify");
    }
    set renotify(value) {
        this._reflectBool("renotify", value);
    }
    get manual() {
        return this.hasAttribute("manual");
    }
    set manual(value) {
        this._reflectBool("manual", value);
    }
    // --- Reactive command-property ---
    get notice() {
        return this._notice;
    }
    set notice(value) {
        // Reactive: writing a new value shows it. `manual` mutes the path entirely
        // (the imperative `notify` command still works). A conforming binder never
        // delivers `undefined` (it skips the write), but a direct assignment can, so
        // normalize null/undefined to a no-op.
        if (value == null)
            return;
        if (this.manual)
            return;
        const v = String(value);
        // Same-value guard: only show when the bound source actually changes. To show
        // the same text again on demand, use the `notify` command instead. (This is
        // the only spam guard the package provides — see docs § 2-c; debounce is the
        // caller's job via a filter, e.g. `notice@x|debounce(1000)`.)
        if (v === this._notice)
            return;
        this._notice = v;
        this.notify(v);
    }
    // --- Core delegated getters ---
    get permission() {
        return this._core.permission;
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
    get error() {
        return this._core.error;
    }
    get clicked() {
        return this._core.clicked;
    }
    get closed() {
        return this._core.closed;
    }
    get shown() {
        return this._core.shown;
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // --- Commands ---
    request() {
        return this._core.request();
    }
    notify(title, options) {
        // Explicit options (from a command-token emit) win per-key over the attribute
        // defaults, so `notify.emit(title, { body })` still picks up the element's icon.
        return this._core.notify(title, { ...this._options(), ...(options ?? {}) });
    }
    close(tag) {
        this._core.close(tag);
    }
    closeAll() {
        this._core.closeAll();
    }
    // --- Internal ---
    _reflect(name, value) {
        if (value == null) {
            this.removeAttribute(name);
        }
        else {
            this.setAttribute(name, String(value));
        }
    }
    _reflectBool(name, value) {
        if (value) {
            this.setAttribute(name, "");
        }
        else {
            this.removeAttribute(name);
        }
    }
    _options() {
        const o = {};
        if (this.body !== "")
            o.body = this.body;
        if (this.icon !== "")
            o.icon = this.icon;
        if (this.badge !== "")
            o.badge = this.badge;
        if (this.tag !== "")
            o.tag = this.tag;
        if (this.lang !== "")
            o.lang = this.lang;
        if (this.dir === "auto" || this.dir === "ltr" || this.dir === "rtl")
            o.dir = this.dir;
        if (this.requireInteraction)
            o.requireInteraction = true;
        if (this.silent)
            o.silent = true;
        if (this.renotify)
            o.renotify = true;
        return o;
    }
    // --- Lifecycle ---
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        // Begin observing permission and subscribing to SW click relays (or revive
        // after a reconnect). The returned promise is held as connectedCallbackPromise
        // for SSR.
        this._connectedCallbackPromise = this._core.observe(this.mode);
    }
    disconnectedCallback() {
        // Detach subscriptions. Open notifications are left on screen (see Core docs);
        // call close()/closeAll() to dismiss.
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.notify)) {
        customElements.define(config.tagNames.notify, WcsNotify);
    }
}

function bootstrapNotification(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { NotificationCore, WcsNotify, bootstrapNotification, getConfig };
//# sourceMappingURL=index.esm.js.map

const _config = {
    autoTrigger: true,
    triggerAttribute: "data-broadcast-target",
    tagNames: {
        broadcast: "wcs-broadcast",
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
// Live reference to the mutable internal config: reads always reflect the latest
// setConfig() call. The readonly IConfig type only blocks callers from writing
// through it — the underlying object still changes. If you need a stable,
// frozen snapshot that won't move under you, use getConfig() instead.
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
 * broadcastCapabilities.ts
 *
 * Broadcast node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。BroadcastChannel の post / message は concurrent-independent(競合しない)
 * ため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 */
/** 安定した broadcast error code(taxonomy)。値は公開キーとして固定。 */
const WCS_BROADCAST_ERROR_CODE = {
    /** BroadcastChannel コンストラクタ不在(`_unsupportedError()` の `NotSupportedError`)。 */
    CapabilityMissing: "capability-missing",
    /** structured clone 不可な payload を post(`DataCloneError`)。呼び出し側入力の不備。 */
    InvalidArgument: "invalid-argument",
    /** その他の post / channel 失敗(DataError / InvalidStateError / "Error" fallback など)。 */
    BroadcastError: "broadcast-error",
};
/**
 * 正規化済み error(`{ name, message }`)を serializable な error taxonomy に写す。
 * `name` は `DOMException.name`(`_normalizeError`)/ 合成名(`_unsupportedError` の
 * `NotSupportedError`、`messageerror` の `DataError`、post 前の `InvalidStateError`)。
 *
 * - `NotSupportedError`(BroadcastChannel 不在)は利用直前の能力欠如 → phase="probe" /
 *   capability-missing。
 * - `DataCloneError`(structured clone 不可な payload を post)は呼び出し側入力の不備 →
 *   phase="execute" / invalid-argument。
 * - それ以外(`DataError` の deserialize 失敗 / `InvalidStateError` / "Error" fallback)は
 *   phase="execute" / broadcast-error。
 * いずれも同一入力の再送では回復しない(recoverable=false)。
 */
function deriveBroadcastErrorInfo(error) {
    if (error.name === "NotSupportedError") {
        return { code: WCS_BROADCAST_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message: error.message };
    }
    if (error.name === "DataCloneError") {
        return { code: WCS_BROADCAST_ERROR_CODE.InvalidArgument, phase: "execute", recoverable: false, message: error.message };
    }
    return { code: WCS_BROADCAST_ERROR_CODE.BroadcastError, phase: "execute", recoverable: false, message: error.message };
}

/**
 * Headless cross-tab messaging primitive. A thin, framework-agnostic wrapper
 * around the BroadcastChannel API exposed through the wc-bindable protocol.
 *
 * BroadcastChannel is a same-origin pub/sub bus: every context (tab, iframe,
 * worker) that opens a channel with the same `name` receives every other
 * context's posts — but NOT its own. This self-exclusion is the whole point:
 * `post` is a `state → element` action (command-token) and an incoming
 * `message` is an `element → state` notification (event-token), but the two
 * only close the loop *across* a context boundary. Within a single tab a lone
 * `<wcs-broadcast>` never hears itself; open the page in two tabs to see the
 * round-trip.
 *
 * Unlike WebSocketCore there is no connection state, no reconnect, and no wire
 * encoding: a channel is "open" the moment it is constructed, and payloads ride
 * the browser's structured clone (objects pass through as-is, no JSON
 * round-trip). The only failure surfaces are a non-cloneable `post`
 * (`DataCloneError`), a `messageerror` (a peer posted something this context
 * cannot deserialize), and an absent `BroadcastChannel` constructor
 * (`unsupported`). All three flow through the `error` property — the Core never
 * throws — symmetrical with FetchCore / ClipboardCore.
 */
class BroadcastCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "message", event: "wcs-broadcast:message" },
            { name: "error", event: "wcs-broadcast:error" },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output derived from `error` (the DOMException.name /
            // synthetic name); the existing `error` property/event are unchanged. Fires
            // wcs-broadcast:error-info-changed. No lane — post/message are concurrent-
            // independent (mirrors ClipboardCore).
            { name: "errorInfo", event: "wcs-broadcast:error-info-changed" },
        ],
        commands: [
            { name: "open" },
            { name: "post" },
            { name: "close" },
        ],
    };
    _target;
    _channel = null;
    _name = null;
    _message = null;
    _error = null;
    _errorInfo = null;
    // Generation guard (§3.4): bumped on dispose(). An incoming message /
    // messageerror that fires after the Shell disconnected (a peer posted between
    // disconnect and the channel actually closing, or a queued event drains late)
    // has a stale `gen` and MUST NOT write state to a torn-down element. A boolean
    // flag is insufficient: dispose→reconnect would let a stale event slip through.
    _gen = 0;
    // SSR (§3.8): a channel opens synchronously (no asynchronous probe to await),
    // so readiness is immediate.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get ready() {
        return this._ready;
    }
    get message() {
        return this._message;
    }
    get error() {
        return this._error;
    }
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-broadcast:error-info-changed`), derived from `error`; the existing
     * `error` property/event are unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
    }
    // --- Lifecycle (§3.5) ---
    // observe() establishes monitoring. BroadcastChannel is command-driven (the
    // Shell calls open(name) from connectedCallback / attributeChangedCallback),
    // so there is no subscription for observe() to set up here: it is an idempotent
    // no-op that resolves once ready. It exists for skeleton symmetry with the
    // monitor-style nodes so a host can uniformly await observe() == ready.
    observe() {
        return this._ready;
    }
    // --- State setters with event dispatch ---
    // Deliberately NO same-value guard (unlike `error` below). A received message
    // is an event, not idempotent state: a peer posting the same value twice is
    // two distinct occurrences and must re-fire wcs-broadcast:message each time so
    // a `message:` binding and any `eventToken.message:` subscriber see both.
    _setMessage(message) {
        this._message = message;
        this._target.dispatchEvent(new CustomEvent("wcs-broadcast:message", {
            detail: message,
            bubbles: true,
        }));
    }
    _setError(error) {
        // Same-value guard. `error` has no derived state, so suppressing redundant
        // null→null dispatches (e.g. a successful open clearing an already-null
        // error) avoids spurious events. Reference identity is sufficient: each
        // failure builds a fresh object, and the clear path always passes null.
        if (this._error === error)
            return;
        this._error = error;
        // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the
        // error name (or null on clear). Fires before the `error` event so an observer
        // binding both sees the classification first, mirroring the io-node family.
        this._commitErrorInfo(error === null ? null : deriveBroadcastErrorInfo(error));
        this._target.dispatchEvent(new CustomEvent("wcs-broadcast:error", {
            detail: error,
            bubbles: true,
        }));
    }
    // Called only from _setError (which already same-value-guards on reference
    // identity), so errorInfo transitions exactly when error does — no separate
    // guard needed here.
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-broadcast:error-info-changed", {
            detail: info,
            bubbles: true,
        }));
    }
    // --- Public API ---
    /**
     * Join the named channel. Any previously-open channel is closed first, so
     * calling `open()` again switches channels. When the BroadcastChannel
     * constructor is unavailable this surfaces an `unsupported` error and leaves
     * the Core channel-less (a later `post()` then errors loudly rather than
     * silently dropping).
     */
    open(name) {
        if (!this._hasBroadcastChannel()) {
            this._setError(this._unsupportedError());
            return;
        }
        // Idempotent on the same channel: re-opening the channel we are already on
        // is pure churn (BroadcastChannel has no reconnect semantics). This also
        // absorbs the custom-element *upgrade* path — when a connected element with
        // a `name` attribute is upgraded (autoloader defines the tag after the
        // markup exists), the spec fires attributeChangedCallback (isConnected ===
        // true) *and* connectedCallback, so the Shell calls open() twice. Without
        // this guard that would create a channel and immediately tear it down.
        if (this._channel && this._name === name)
            return;
        this._closeChannel();
        this._setError(null);
        // Capture the generation for this channel (§3.4). The listeners below close
        // over `gen`; an event that fires after dispose() (which bumps _gen) is
        // recognised as stale and dropped without writing state to a torn-down
        // element. The handlers are stored so _closeChannel() can remove them by the
        // same reference.
        const gen = ++this._gen;
        const channel = new BroadcastChannel(name);
        this._onMessage = (event) => {
            if (gen !== this._gen)
                return;
            this._setMessage(event.data);
        };
        // Fired when a peer posted a value this context cannot deserialize. The event
        // carries no usable payload, so report a synthetic DataError.
        this._onMessageError = () => {
            if (gen !== this._gen)
                return;
            this._setError({
                name: "DataError",
                message: "Failed to deserialize a message received on the channel.",
            });
        };
        channel.addEventListener("message", this._onMessage);
        channel.addEventListener("messageerror", this._onMessageError);
        this._channel = channel;
        this._name = name;
    }
    /**
     * Post a structured-cloneable value to every other context on the channel.
     * The local context never receives it (self-exclusion). Never throws:
     * a non-cloneable value surfaces as a `DataCloneError` through `error`, and
     * posting with no open channel surfaces an `InvalidStateError`.
     */
    post(data) {
        if (!this._hasBroadcastChannel()) {
            this._setError(this._unsupportedError());
            return;
        }
        if (!this._channel) {
            this._setError({
                name: "InvalidStateError",
                message: "Channel is not open. Call open(name) before post().",
            });
            return;
        }
        try {
            this._channel.postMessage(data);
        }
        catch (err) {
            this._setError(this._normalizeError(err));
        }
    }
    /** Leave the channel. Idempotent — a no-op when no channel is open. */
    close() {
        this._closeChannel();
    }
    /**
     * Tear the Core down for a disconnected Shell: close the channel and reset the
     * error shadow silently (no dispatch on a torn-down element). A later
     * reconnect re-opens via the Shell's connectedCallback.
     *
     * Asymmetry by design: `_message` is deliberately NOT reset. `error` is
     * transient connection state — a stale error from a previous channel would be
     * misleading after a reconnect, so it is cleared. `message` is the last value
     * received (an event payload), not connection state; it is retained as the
     * Core's last-known datum so a binding still reads it across a disconnect/
     * reconnect, and it is naturally overwritten by the next incoming message.
     */
    dispose() {
        // Bump the generation first (§3.4) so any message/messageerror that drains
        // after teardown is recognised as stale, then close the channel and reset the
        // error shadow silently.
        this._gen++;
        this._closeChannel();
        this._error = null;
        // dispose bypasses _setError (silent, no dispatch on a torn-down element), so
        // clear the errorInfo mirror directly too — otherwise a stale taxonomy would
        // survive after `error` has been reset to null.
        this._errorInfo = null;
    }
    // --- Internal ---
    // Per-channel listeners, (re)created in open() so each closes over its own
    // generation (§3.4). null while no channel is open; the real handlers are
    // installed by open() and removed by the same reference in _closeChannel().
    _onMessage = null;
    _onMessageError = null;
    _closeChannel() {
        if (!this._channel)
            return;
        this._channel.removeEventListener("message", this._onMessage);
        this._channel.removeEventListener("messageerror", this._onMessageError);
        this._channel.close();
        this._channel = null;
        this._name = null;
        this._onMessage = null;
        this._onMessageError = null;
    }
    _hasBroadcastChannel() {
        return typeof BroadcastChannel !== "undefined";
    }
    _normalizeError(err) {
        if (err instanceof Error) {
            // DOMException is an Error subclass; its `name` (DataCloneError, etc.) is
            // the meaningful discriminator for consumers switching on failure kind.
            return { name: err.name, message: err.message };
        }
        return { name: "Error", message: String(err) };
    }
    _unsupportedError() {
        return {
            name: "NotSupportedError",
            message: "BroadcastChannel is not available in this environment.",
        };
    }
}

let registered = false;
// Attribute names for the optional post-on-click DOM trigger (clipboard.js-style
// DX). The element carrying `data-broadcast-target` points at a <wcs-broadcast>
// by id; the text to post comes from either a literal `data-broadcast-text` or
// a `data-broadcast-from` CSS selector resolving to a source element.
const TEXT_ATTRIBUTE = "data-broadcast-text";
const FROM_ATTRIBUTE = "data-broadcast-from";
function resolveText(triggerElement) {
    // Literal text wins when present (including an empty string — posting "" is a
    // legitimate request). The `?? ""` right-hand side is defensive and
    // unreachable: hasAttribute() just returned true, so getAttribute() cannot be
    // null here. It exists only to satisfy the `string | null` return type — do
    // not chase coverage on it (the DOM contract makes the null branch impossible).
    if (triggerElement.hasAttribute(TEXT_ATTRIBUTE)) {
        return triggerElement.getAttribute(TEXT_ATTRIBUTE) ?? "";
    }
    const selector = triggerElement.getAttribute(FROM_ATTRIBUTE);
    if (!selector)
        return null;
    // A user-authored selector can be syntactically invalid (e.g. `[data-*` or a
    // bare `:not()`), which makes querySelector throw a SyntaxError. Swallow it
    // and treat the source as unresolvable — the same "nothing to post" path as a
    // selector that matches no element — so one bad attribute never crashes the
    // document-level click handler and kills autoTrigger for the whole tab.
    let source;
    try {
        source = document.querySelector(selector);
    }
    catch {
        return null;
    }
    if (!source)
        return null;
    // Read a form control's `value`; fall back to text content. A bare
    // `"value" in source` check is too broad — it also matches <button>,
    // <li value>, <progress>, etc. (which carry an unrelated `value`), posting the
    // wrong thing. Narrow to the text-bearing controls a user actually points
    // `data-broadcast-from` at; everything else falls through to textContent.
    if (source instanceof HTMLInputElement ||
        source instanceof HTMLTextAreaElement ||
        source instanceof HTMLSelectElement) {
        return source.value;
    }
    // `?? ""` is defensive: per the DOM spec only Document / DocumentType /
    // Notation nodes have a null `textContent`, and querySelector only ever
    // returns an Element (whose textContent is always a string). The branch is
    // therefore unreachable in practice and kept solely for the `string | null`
    // type — not worth a contrived test.
    return source.textContent ?? "";
}
function handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element))
        return;
    const triggerElement = target.closest(`[${config.triggerAttribute}]`);
    if (!triggerElement)
        return;
    const broadcastId = triggerElement.getAttribute(config.triggerAttribute);
    if (!broadcastId)
        return;
    // Resolve the registered constructor at call time instead of importing
    // WcsBroadcast as a value (avoids a components ⇄ autoTrigger import cycle:
    // Broadcast.connectedCallback() calls registerAutoTrigger()). instanceof
    // against the customElements registry keeps the same identity guarantee.
    const BroadcastCtor = customElements.get(config.tagNames.broadcast);
    const broadcastElement = document.getElementById(broadcastId);
    if (!BroadcastCtor || !(broadcastElement instanceof BroadcastCtor))
        return;
    const text = resolveText(triggerElement);
    // No resolvable source: leave the click alone (do not preventDefault) so the
    // element's default action is unaffected.
    if (text === null)
        return;
    // Suppress the default action so a post can run without navigating. Intentional:
    // do not attach data-broadcast-target to an element whose default action you
    // also want (a real <a href> link). See README "Optional DOM Triggering".
    event.preventDefault();
    broadcastElement.post(text);
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

// Named WcsBroadcast (not `Broadcast`) to match the <wcs-clipboard> WcsClipboard
// / <wcs-ws> WcsWebSocket convention and avoid shadowing any global.
class WcsBroadcast extends HTMLElement {
    // SSR (§4.4): the channel opens synchronously in connectedCallback, so the
    // Core's observe() resolves immediately; we still expose connectedCallbackPromise
    // so a state binder can uniformly await readiness before snapshotting.
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...BroadcastCore.wcBindable,
        // Shell-level settable surface. `name` selects the channel; `manual`
        // suppresses auto-open on connect. There is no momentary `post` property:
        // posting needs an argument (the payload), so element actions run via
        // command-token (`command.post: $command.ping`) or the DOM autoTrigger, not
        // a value-derived setter — keeping `post` a plain command keeps the
        // command-token wiring (`command.post:`) readable.
        inputs: [
            { name: "name", attribute: "name" },
            { name: "manual", attribute: "manual" },
        ],
        // Commands are identical to the Core's — no rename needed since the `name` /
        // `manual` attribute accessors do not collide with open/post/close.
        commands: BroadcastCore.wcBindable.commands,
    };
    static get observedAttributes() { return ["name"]; }
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new BroadcastCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-broadcast:error": (d) => ({ error: d != null }),
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
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // --- Attribute accessors ---
    get name() {
        return this.getAttribute("name") || "";
    }
    set name(value) {
        this.setAttribute("name", value);
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
    get message() {
        return this._core.message;
    }
    get error() {
        return this._core.error;
    }
    get errorInfo() {
        return this._core.errorInfo;
    }
    // --- Commands ---
    open() {
        if (this.name) {
            this._core.open(this.name);
        }
    }
    post(data) {
        this._core.post(data);
    }
    close() {
        this._core.close();
    }
    // --- Lifecycle ---
    attributeChangedCallback(name, _oldValue, newValue) {
        if (name === "name" && this.isConnected && !this.manual && newValue) {
            this._core.open(newValue);
        }
    }
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        if (!this.manual && this.name) {
            this._core.open(this.name);
        }
        // SSR (§4.4): expose the Core's readiness as connectedCallbackPromise. The
        // channel opens synchronously above, so observe() resolves immediately.
        this._connectedCallbackPromise = this._core.observe();
    }
    disconnectedCallback() {
        // Deliberately does NOT call unregisterAutoTrigger(). The autoTrigger click
        // listener is a single process-wide document listener (registerAutoTrigger
        // is idempotent), shared by every <wcs-broadcast> on the page — not owned by
        // this element. Tearing it down when the last element disconnects would
        // break a later-inserted trigger, so it is intentionally left installed for
        // the document's lifetime (one passive listener, negligible cost). This
        // mirrors <wcs-clipboard>, which registers but never unregisters either.
        // unregisterAutoTrigger stays exported purely as a symmetric teardown hook
        // for tests / advanced manual control; the production lifecycle never calls
        // it.
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.broadcast)) {
        customElements.define(config.tagNames.broadcast, WcsBroadcast);
    }
}

function bootstrapBroadcast(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { BroadcastCore, WCS_BROADCAST_ERROR_CODE, WcsBroadcast, bootstrapBroadcast, getConfig };
//# sourceMappingURL=index.esm.js.map

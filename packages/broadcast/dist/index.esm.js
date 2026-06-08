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
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get message() {
        return this._message;
    }
    get error() {
        return this._error;
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
        this._target.dispatchEvent(new CustomEvent("wcs-broadcast:error", {
            detail: error,
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
        const channel = new BroadcastChannel(name);
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
        this._closeChannel();
        this._error = null;
    }
    // --- Internal ---
    _onMessage = (event) => {
        this._setMessage(event.data);
    };
    // Fired when a peer posted a value this context cannot deserialize. The event
    // carries no usable payload, so report a synthetic DataError.
    _onMessageError = () => {
        this._setError({
            name: "DataError",
            message: "Failed to deserialize a message received on the channel.",
        });
    };
    _closeChannel() {
        if (!this._channel)
            return;
        this._channel.removeEventListener("message", this._onMessage);
        this._channel.removeEventListener("messageerror", this._onMessageError);
        this._channel.close();
        this._channel = null;
        this._name = null;
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
    // The channel opens synchronously in connectedCallback (no async init), so no
    // connectedCallbackPromise is needed — mirrors <wcs-ws>.
    static hasConnectedCallbackPromise = false;
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
    constructor() {
        super();
        this._core = new BroadcastCore(this);
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

export { BroadcastCore, WcsBroadcast, bootstrapBroadcast, getConfig };
//# sourceMappingURL=index.esm.js.map

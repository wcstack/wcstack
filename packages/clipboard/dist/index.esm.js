const _config = {
    autoTrigger: true,
    triggerAttribute: "data-clipboardtarget",
    tagNames: {
        clipboard: "wcs-clipboard",
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
 * Headless clipboard primitive. A thin, framework-agnostic wrapper around the
 * Clipboard API exposed through the wc-bindable protocol.
 *
 * It has two surfaces, mirroring the two distinct shapes of clipboard access:
 * - **commands** — `writeText()` / `write()` push to the clipboard;
 *   `readText()` / `read()` pull from it. These are the `state → element`
 *   (command-token) and `element → state` (read result) paths. All four are
 *   async and never reject: failures surface through the `error` property so
 *   they flow into the declarative state, symmetrical with FetchCore /
 *   GeolocationCore.
 * - **monitor** — `startMonitor()` / `stopMonitor()` subscribe to the document's
 *   `copy` / `cut` / `paste` events and republish them as the `copied` / `cut` /
 *   `pasted` properties (like TimerCore's continuous `start()` / `stop()`),
 *   toggling the `monitoring` flag. This is the event-token showcase: a user
 *   paste flows element → state declaratively.
 *
 * Clipboard also has permission gates, like GeolocationCore but doubled: read
 * and write are separate permissions (`clipboard-read` / `clipboard-write`).
 * `readPermission` / `writePermission` reflect `navigator.permissions.query`
 * (`prompt` / `granted` / `denied`, or `unsupported`) and track their live
 * `change` events.
 */
class ClipboardCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "text", event: "wcs-clipboard:read", getter: (e) => e.detail.text },
            { name: "items", event: "wcs-clipboard:read", getter: (e) => e.detail.items },
            { name: "loading", event: "wcs-clipboard:loading-changed" },
            { name: "error", event: "wcs-clipboard:error" },
            { name: "readPermission", event: "wcs-clipboard:read-permission-changed" },
            { name: "writePermission", event: "wcs-clipboard:write-permission-changed" },
            { name: "monitoring", event: "wcs-clipboard:monitoring-changed" },
            { name: "copied", event: "wcs-clipboard:copied", getter: (e) => e.detail },
            { name: "cut", event: "wcs-clipboard:cut", getter: (e) => e.detail },
            { name: "pasted", event: "wcs-clipboard:pasted", getter: (e) => e.detail },
        ],
        commands: [
            { name: "writeText", async: true },
            { name: "write", async: true },
            { name: "readText", async: true },
            { name: "read", async: true },
            { name: "startMonitor" },
            { name: "stopMonitor" },
        ],
    };
    _target;
    _text = null;
    _items = null;
    _loading = false;
    _error = null;
    _readPermission = "prompt";
    _writePermission = "prompt";
    _monitoring = false;
    _copied = null;
    _cut = null;
    _pasted = null;
    // Live PermissionStatus handles (when the Permissions API is available), kept
    // so the `change` listeners can be removed on dispose(). Read and write are
    // separate permissions, hence two handles.
    _readStatus = null;
    _writeStatus = null;
    // True once a permission subscription has been (or is being) established, and
    // reset by dispose(). Guards reinitPermission() so the first connect after
    // construction does not double-subscribe, while a reconnect after dispose()
    // does re-subscribe. (Mirrors GeolocationCore.)
    _permissionSubscribed = false;
    // Monotonic id of the current permission query round. Bumped by every
    // _initPermissions() and by dispose(). Each in-flight query captures it and,
    // on resolve, bails unless it is still current — so a query superseded by a
    // rapid (synchronous) disconnect→reconnect, or one that resolves after
    // dispose(), never attaches a listener.
    _permGen = 0;
    // Monotonic id of the current async acquisition lifecycle (read/write),
    // bumped only by dispose(). Each command captures it at start; the resolution
    // bails (no setters) if it is stale, so an op that settles after the element
    // was disconnected does not dispatch wcs-clipboard:* on a torn-down element.
    // The Clipboard API has no AbortController, so a generation guard is the only
    // way to neutralize an in-flight op.
    _acqGen = 0;
    constructor(target) {
        super();
        this._target = target ?? this;
        // Probe the permission states up front so observers see the real values
        // before the first read, then keep them live.
        this._initPermissions();
    }
    get text() {
        return this._text;
    }
    get items() {
        return this._items;
    }
    get loading() {
        return this._loading;
    }
    get error() {
        return this._error;
    }
    get readPermission() {
        return this._readPermission;
    }
    get writePermission() {
        return this._writePermission;
    }
    get monitoring() {
        return this._monitoring;
    }
    get copied() {
        return this._copied;
    }
    get cut() {
        return this._cut;
    }
    get pasted() {
        return this._pasted;
    }
    // --- State setters with event dispatch ---
    // Deliberately NO same-value guard (unlike error/loading/permission/monitoring).
    // A read is a result event, not idempotent state: reading the same text twice is
    // two distinct user/command actions and must re-fire wcs-clipboard:read each time
    // so a `text:`/`items:` binding and command-result consumers see every read.
    _setRead(detail) {
        this._text = detail.text;
        this._items = detail.items;
        this._target.dispatchEvent(new CustomEvent("wcs-clipboard:read", {
            detail,
            bubbles: true,
        }));
    }
    _setLoading(loading) {
        if (this._loading === loading)
            return;
        this._loading = loading;
        this._target.dispatchEvent(new CustomEvent("wcs-clipboard:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    _setError(error) {
        // Same-value guard. `error` has no derived state, so suppressing redundant
        // null→null dispatches (e.g. a successful op clearing an already-null error)
        // avoids spurious events. Reference identity is sufficient: each failure
        // builds a fresh object, and the clear path always passes the literal null.
        if (this._error === error)
            return;
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-clipboard:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _setReadPermission(permission) {
        if (this._readPermission === permission)
            return;
        this._readPermission = permission;
        this._target.dispatchEvent(new CustomEvent("wcs-clipboard:read-permission-changed", {
            detail: permission,
            bubbles: true,
        }));
    }
    _setWritePermission(permission) {
        if (this._writePermission === permission)
            return;
        this._writePermission = permission;
        this._target.dispatchEvent(new CustomEvent("wcs-clipboard:write-permission-changed", {
            detail: permission,
            bubbles: true,
        }));
    }
    _setMonitoring(monitoring) {
        if (this._monitoring === monitoring)
            return;
        this._monitoring = monitoring;
        this._target.dispatchEvent(new CustomEvent("wcs-clipboard:monitoring-changed", {
            detail: monitoring,
            bubbles: true,
        }));
    }
    // Deliberately NO same-value guard on the copied/cut/pasted setters (unlike
    // error/loading/permission/monitoring above). These are events, not state:
    // copying the same text twice is two distinct user actions and must re-fire
    // both times so an event-token subscriber (`eventToken.pasted: ...`) sees each
    // occurrence. Do not add a `===` guard here.
    _setCopied(text) {
        this._copied = text;
        this._target.dispatchEvent(new CustomEvent("wcs-clipboard:copied", {
            detail: text,
            bubbles: true,
        }));
    }
    _setCut(text) {
        this._cut = text;
        this._target.dispatchEvent(new CustomEvent("wcs-clipboard:cut", {
            detail: text,
            bubbles: true,
        }));
    }
    _setPasted(text) {
        this._pasted = text;
        this._target.dispatchEvent(new CustomEvent("wcs-clipboard:pasted", {
            detail: text,
            bubbles: true,
        }));
    }
    // --- Public API: write ---
    /**
     * Write plain text to the clipboard. Resolves once the write settles or fails
     * — never rejects: failures surface through `error`. Requires transient
     * activation (a user gesture), so call from a click handler / command-token.
     */
    writeText(text) {
        return this._runWrite(() => navigator.clipboard.writeText(text));
    }
    /**
     * Write rich `ClipboardItem`s (images, HTML, multiple MIME types) to the
     * clipboard. Resolves once the write settles or fails — never rejects.
     */
    write(items) {
        return this._runWrite(() => navigator.clipboard.write(items));
    }
    // --- Public API: read ---
    /**
     * Read plain text from the clipboard, publishing it via `text` and the
     * `wcs-clipboard:read` event. Resolves once the read settles or fails — never
     * rejects. Requires focus + read permission.
     */
    readText() {
        return this._runRead(async () => {
            const text = await navigator.clipboard.readText();
            return { text, items: null };
        });
    }
    /**
     * Read rich `ClipboardItem`s from the clipboard, eagerly resolving every
     * representation to a `Blob`. A `text/plain` representation is also surfaced
     * via `text`. Resolves once the read settles or fails — never rejects.
     */
    read() {
        return this._runRead(async () => {
            const items = await navigator.clipboard.read();
            return this._normalizeItems(items);
        });
    }
    // --- Public API: monitor ---
    /**
     * Begin monitoring document `copy` / `cut` / `paste` events, republishing
     * them as the `copied` / `cut` / `pasted` properties. Idempotent while already
     * monitoring (mirrors GeolocationCore.watch()).
     */
    startMonitor() {
        if (this._monitoring)
            return;
        this._setMonitoring(true);
        document.addEventListener("copy", this._onCopy);
        document.addEventListener("cut", this._onCut);
        document.addEventListener("paste", this._onPaste);
    }
    stopMonitor() {
        this._removeMonitorListeners();
        this._setMonitoring(false);
    }
    // --- Permission lifecycle ---
    /**
     * Re-establish the permission `change` subscriptions after a dispose() — e.g.
     * the Shell element was disconnected and then reconnected (reparented). No-op
     * while a subscription is already live, so the first connect after
     * construction does not double-subscribe.
     */
    reinitPermission() {
        if (!this._permissionSubscribed) {
            this._initPermissions();
        }
    }
    /**
     * Detach the live permission `change` listeners and any monitor listeners, and
     * neutralize in-flight async ops. Call from the Shell's `disconnectedCallback`
     * so a removed element does not leak subscriptions or dispatch on a torn-down
     * element. A later reconnect can re-subscribe via reinitPermission().
     */
    dispose() {
        this._permissionSubscribed = false;
        // Invalidate any in-flight permission query so its .then() bails instead of
        // attaching a listener after teardown.
        this._permGen++;
        // Invalidate any in-flight read/write so its resolution bails instead of
        // dispatching on a disconnected element.
        this._acqGen++;
        // Reset the loading shadow silently (no dispatch on a disposed element). The
        // bailed resolution will not clear it, and leaving it true would let the
        // same-value guard swallow the loading=true edge of the next op after a
        // reconnect.
        this._loading = false;
        if (this._readStatus) {
            this._readStatus.removeEventListener("change", this._onReadChange);
            this._readStatus = null;
        }
        if (this._writeStatus) {
            this._writeStatus.removeEventListener("change", this._onWriteChange);
            this._writeStatus = null;
        }
        // Remove monitor listeners silently. The Shell calls stopMonitor() before
        // dispose(), but a direct headless dispose() still tears them down.
        this._removeMonitorListeners();
        this._monitoring = false;
    }
    // --- Internal: write/read runners ---
    _runWrite(op) {
        return this._runOp(async () => {
            await op();
            return null;
        });
    }
    _runRead(op) {
        return this._runOp(op);
    }
    /**
     * Shared async-op lifecycle for read/write: capability check, loading toggle,
     * generation guard, never-reject error handling. When `op` returns a read
     * detail it is published; when it returns null (a write) nothing is published.
     */
    async _runOp(op) {
        if (!this._hasClipboard()) {
            this._setError(this._unsupportedError());
            return;
        }
        const gen = this._acqGen;
        this._setLoading(true);
        this._setError(null);
        try {
            const detail = await op();
            // Stale: the element was disposed (disconnected) while this op was in
            // flight. Drop it so a torn-down element never dispatches wcs-clipboard:*.
            if (gen !== this._acqGen)
                return;
            this._setLoading(false);
            if (detail)
                this._setRead(detail);
        }
        catch (err) {
            if (gen !== this._acqGen)
                return;
            this._setLoading(false);
            this._setError(this._normalizeError(err));
        }
    }
    // --- Internal: monitor handlers ---
    // During a `copy` / `cut` event the clipboard payload is not yet readable —
    // the browser returns an empty string for security reasons — so we report the
    // user's selected text (`document.getSelection().toString()`) instead. A page
    // that overrides the payload with a custom handler via clipboardData.setData()
    // is therefore NOT reflected here. (See README "copy / cut text comes from the
    // selection".) `paste` differs: clipboardData is readable, so _onPaste reads it.
    _onCopy = () => {
        this._setCopied(this._selectionText());
    };
    _onCut = () => {
        this._setCut(this._selectionText());
    };
    _onPaste = (event) => {
        const data = event.clipboardData;
        const text = data ? data.getData("text/plain") : "";
        this._setPasted(text);
    };
    _removeMonitorListeners() {
        document.removeEventListener("copy", this._onCopy);
        document.removeEventListener("cut", this._onCut);
        document.removeEventListener("paste", this._onPaste);
    }
    _selectionText() {
        const selection = document.getSelection();
        return selection ? selection.toString() : "";
    }
    // --- Internal: permission ---
    _initPermissions() {
        // The Permissions API is optional. When absent (or it rejects, e.g. Firefox
        // does not expose the clipboard permission names), report "unsupported" and
        // leave reads/writes to fail loudly via the error property if attempted.
        // Note: we deliberately do NOT set _permissionSubscribed here — there is no
        // live subscription to tear down, so reinitPermission() re-runs this branch
        // on every reconnect. That is harmless: the same-value guard in
        // _setReadPermission/_setWritePermission swallows the redundant
        // unsupported→unsupported dispatch. (Mirrors GeolocationCore.)
        if (typeof navigator === "undefined" || !navigator.permissions || typeof navigator.permissions.query !== "function") {
            this._setReadPermission("unsupported");
            this._setWritePermission("unsupported");
            return;
        }
        this._permissionSubscribed = true;
        const gen = ++this._permGen;
        this._queryPermission("clipboard-read", gen, (s) => { this._readStatus = s; }, (state) => this._setReadPermission(state), this._onReadChange);
        this._queryPermission("clipboard-write", gen, (s) => { this._writeStatus = s; }, (state) => this._setWritePermission(state), this._onWriteChange);
    }
    _queryPermission(name, gen, assignStatus, setState, onChange) {
        navigator.permissions.query({ name: name }).then((status) => {
            // Stale resolution: this query was superseded (rapid reconnect) or the
            // element was disposed while it was in flight. Drop it so only the
            // current subscription attaches a listener.
            if (gen !== this._permGen)
                return;
            assignStatus(status);
            setState(status.state);
            status.addEventListener("change", onChange);
        }, () => {
            if (gen !== this._permGen)
                return;
            setState("unsupported");
        });
    }
    _onReadChange = (event) => {
        const status = event.target;
        this._setReadPermission(status.state);
    };
    _onWriteChange = (event) => {
        const status = event.target;
        this._setWritePermission(status.state);
    };
    // --- Internal: normalization ---
    _hasClipboard() {
        return typeof navigator !== "undefined" && !!navigator.clipboard;
    }
    async _normalizeItems(items) {
        // Resolve every representation of every item in parallel. getType() calls are
        // independent, so awaiting them serially only adds latency. The trade-off is
        // intentional and unchanged from the serial version: if any getType() rejects
        // the whole read errors (no partial success), consistent with the never-reject
        // design where a failed op surfaces a single `error` rather than a half-filled
        // snapshot. Order is preserved so the `text` pick below stays deterministic.
        const resolved = await Promise.all(items.map((item) => Promise.all(item.types.map((type) => item.getType(type))).then((blobs) => ({ item, blobs }))));
        const normalized = [];
        let text = null;
        for (const { item, blobs } of resolved) {
            const data = {};
            item.types.forEach((type, i) => {
                data[type] = blobs[i];
            });
            // Surface the first text/plain representation through `text` for the
            // common "read whatever text is there" case (first item, first match).
            if (text === null) {
                const i = item.types.indexOf("text/plain");
                if (i !== -1) {
                    text = await blobs[i].text();
                }
            }
            normalized.push({ types: [...item.types], data });
        }
        return { text, items: normalized };
    }
    _normalizeError(err) {
        if (err instanceof Error) {
            // DOMException is an Error subclass; its `name` (NotAllowedError, etc.) is
            // the meaningful discriminator for consumers switching on failure kind.
            return { name: err.name, message: err.message };
        }
        return { name: "Error", message: String(err) };
    }
    _unsupportedError() {
        return {
            name: "NotSupportedError",
            message: "Clipboard API is not available in this environment.",
        };
    }
}

let registered = false;
// Attribute names for the optional copy-on-click DOM trigger (clipboard.js-style
// DX). The element carrying `data-clipboardtarget` points at a <wcs-clipboard>
// by id; the text to copy comes from either a literal `data-clipboard-text` or
// a `data-clipboard-from` CSS selector resolving to a source element.
const TEXT_ATTRIBUTE = "data-clipboard-text";
const FROM_ATTRIBUTE = "data-clipboard-from";
function resolveText(triggerElement) {
    // Literal text wins when present (including an empty string — copying "" is a
    // legitimate request).
    if (triggerElement.hasAttribute(TEXT_ATTRIBUTE)) {
        return triggerElement.getAttribute(TEXT_ATTRIBUTE) ?? "";
    }
    const selector = triggerElement.getAttribute(FROM_ATTRIBUTE);
    if (!selector)
        return null;
    const source = document.querySelector(selector);
    if (!source)
        return null;
    // Read a form control's `value`; fall back to text content. A bare
    // `"value" in source` check is too broad — it also matches <button>,
    // <li value>, <progress>, etc. (which carry an unrelated `value`), copying
    // the wrong thing. Narrow to the text-bearing controls a user actually points
    // `data-clipboard-from` at; everything else falls through to textContent.
    if (source instanceof HTMLInputElement ||
        source instanceof HTMLTextAreaElement ||
        source instanceof HTMLSelectElement) {
        return source.value;
    }
    return source.textContent ?? "";
}
function handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element))
        return;
    const triggerElement = target.closest(`[${config.triggerAttribute}]`);
    if (!triggerElement)
        return;
    const clipboardId = triggerElement.getAttribute(config.triggerAttribute);
    if (!clipboardId)
        return;
    // Resolve the registered constructor at call time instead of importing
    // WcsClipboard as a value (avoids a components ⇄ autoTrigger import cycle:
    // Clipboard.connectedCallback() calls registerAutoTrigger()). instanceof
    // against the customElements registry keeps the same identity guarantee.
    const ClipboardCtor = customElements.get(config.tagNames.clipboard);
    const clipboardElement = document.getElementById(clipboardId);
    if (!ClipboardCtor || !(clipboardElement instanceof ClipboardCtor))
        return;
    const text = resolveText(triggerElement);
    // No resolvable source: leave the click alone (do not preventDefault) so the
    // element's default action is unaffected.
    if (text === null)
        return;
    // Suppress the default action so a copy can run without navigating. Intentional:
    // do not attach data-clipboardtarget to an element whose default action you
    // also want (real <a href> link). See README "Optional DOM Triggering".
    event.preventDefault();
    clipboardElement.writeText(text);
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

// Named WcsClipboard (not `Clipboard`) so the class does not shadow the global
// DOM `Clipboard` interface (the type of `navigator.clipboard`), matching the
// <wcs-geo> WcsGeolocation / <wcs-ws> WcsWebSocket convention.
class WcsClipboard extends HTMLElement {
    static wcBindable = {
        ...ClipboardCore.wcBindable,
        // Shell-level settable surface. `monitor` mirrors its boolean attribute
        // (reflects idempotently), following the <wcs-ws> / <wcs-geo> convention.
        // There is no momentary `trigger` property: writes need an argument (the
        // text/items), so element actions are driven via command-token
        // (`command.writeText: $command.copy`) or the DOM autoTrigger, not a
        // false→true boolean pulse.
        inputs: [
            { name: "monitor", attribute: "monitor" },
        ],
        // Commands are identical to the Core's — no rename is needed because the
        // `monitor` boolean attribute accessor does not collide with the
        // `startMonitor` / `stopMonitor` command names (unlike <wcs-geo>, whose
        // `watch` attribute forced the Core's `watch` command to `watchPosition`).
        commands: ClipboardCore.wcBindable.commands,
    };
    _core;
    constructor() {
        super();
        this._core = new ClipboardCore(this);
    }
    // --- Attribute accessors ---
    get monitor() {
        return this.hasAttribute("monitor");
    }
    /**
     * Reflects the `monitor` boolean attribute only — it does NOT start or stop
     * monitoring by itself. The attribute is read at connect time (see
     * connectedCallback); toggling `el.monitor` after connect just flips the
     * attribute. To start/stop monitoring imperatively, call `startMonitor()` /
     * `stopMonitor()`.
     */
    set monitor(value) {
        if (value) {
            this.setAttribute("monitor", "");
        }
        else {
            this.removeAttribute("monitor");
        }
    }
    // --- Core delegated getters ---
    get text() {
        return this._core.text;
    }
    get items() {
        return this._core.items;
    }
    get loading() {
        return this._core.loading;
    }
    get error() {
        return this._core.error;
    }
    get readPermission() {
        return this._core.readPermission;
    }
    get writePermission() {
        return this._core.writePermission;
    }
    get monitoring() {
        return this._core.monitoring;
    }
    get copied() {
        return this._core.copied;
    }
    get cut() {
        return this._core.cut;
    }
    get pasted() {
        return this._core.pasted;
    }
    // --- Commands ---
    writeText(text) {
        return this._core.writeText(text);
    }
    write(items) {
        return this._core.write(items);
    }
    readText() {
        return this._core.readText();
    }
    read() {
        return this._core.read();
    }
    startMonitor() {
        this._core.startMonitor();
    }
    stopMonitor() {
        this._core.stopMonitor();
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
        // Unlike <wcs-geo>, there is no connect-time acquisition: reads require a
        // user gesture, so the only connect-time action is optional monitoring.
        if (this.monitor) {
            this._core.startMonitor();
        }
    }
    disconnectedCallback() {
        this._core.stopMonitor();
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.clipboard)) {
        customElements.define(config.tagNames.clipboard, WcsClipboard);
    }
}

function bootstrapClipboard(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { ClipboardCore, WcsClipboard, bootstrapClipboard, getConfig };
//# sourceMappingURL=index.esm.js.map

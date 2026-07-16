const _config = {
    autoTrigger: true,
    triggerAttribute: "data-worker-target",
    tagNames: {
        worker: "wcs-worker",
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
 * workerCapabilities.ts
 *
 * Worker node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。worker は所有する子スレッドに対する command 駆動(start / post / terminate)
 * であり、競合する複数 operation を lane 管理する必要が無い(post は fire-and-forget、
 * start は張り替えを冪等ガード)ため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 */
/** 安定した worker error code(taxonomy)。値は公開キーとして固定。 */
const WCS_WORKER_ERROR_CODE = {
    /** `Worker` コンストラクタ不在(SSR / 非対応環境で構築が投げる)。 */
    CapabilityMissing: "capability-missing",
    /** `start(src)` の `src` 未指定(TypeError "src is required.")。 */
    InvalidArgument: "invalid-argument",
    /** worker スクリプトの uncaught error / messageerror / post 失敗 / 構築失敗など。 */
    WorkerError: "worker-error",
};
/**
 * 正規化済み worker error(`WcsWorkerErrorDetail`)を serializable な error taxonomy に
 * 写す。`.name` で分岐する:
 *
 * - `TypeError` かつ `message === "src is required."` は `start()` 自身の引数検証。
 *   WorkerCore.start がこの固定 message で立てる唯一の検証 TypeError なので、runtime の
 *   worker error(name は "Error" / "DataError" 等)や構築失敗の TypeError とは message で
 *   一意に切り分かる → phase="start" / invalid-argument。
 * - それ以外の `TypeError` / `ReferenceError` は `new Worker(...)` の構築失敗。global
 *   `Worker` が `undefined` なら `new undefined()` が "... is not a constructor"(TypeError)、
 *   素の Node/SSR で `Worker` が未宣言なら "Worker is not defined"(ReferenceError)を投げる。
 *   いずれも platform API 欠如の顕れ → phase="probe" / capability-missing。runtime の worker
 *   error はこの 2 name を名乗らない(_onError は "Error"、_onMessageError は "DataError")ので
 *   誤爆しない。
 * - それ以外(worker スクリプトの `Error` / messageerror の `DataError` / post の
 *   `InvalidStateError` / `DataCloneError` / 構築時の `SecurityError` 等)は稼働中/構築時の
 *   失敗 → phase="execute" / worker-error。
 *
 * いずれも retry で自動回復しない(recoverable=false)。公開 `error` shape は不変。
 */
function deriveWorkerErrorInfo(error) {
    const { name, message } = error;
    if (name === "TypeError" && message === "src is required.") {
        return { code: WCS_WORKER_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
    }
    if (name === "TypeError" || name === "ReferenceError") {
        return { code: WCS_WORKER_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
    }
    return { code: WCS_WORKER_ERROR_CODE.WorkerError, phase: "execute", recoverable: false, message };
}

/**
 * Headless Dedicated Worker primitive. A thin, framework-agnostic wrapper around
 * the `Worker` API exposed through the wc-bindable protocol.
 *
 * A Worker is a "headless async message-passing resource that owns a child
 * thread" — structurally identical to BroadcastCore (structured-clone payloads,
 * no wire encoding, `post` is a `state → element` command-token and an incoming
 * `message` is an `element → state` event-token) with one extra axis: this Core
 * *owns* the underlying resource, so `start()` / `terminate()` spawn and tear
 * down the thread, mirroring how WebSocketCore owns its socket.
 *
 * Message model is bus-style (fire-and-forget `post`, observe `message`), not
 * RPC: there is no request/response correlation. Payloads ride structured clone
 * with NO JSON round-trip (symmetrical with BroadcastCore, deliberately unlike
 * WebSocketCore). The Core never throws — a spawn failure (bad URL, CSP block,
 * absent `Worker`), a non-cloneable `post` (`DataCloneError`), a `post` with no
 * running worker (`InvalidStateError`), an uncaught worker error, and a
 * `messageerror` all flow through the `error` property.
 */
class WorkerCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "message", event: "wcs-worker:message" },
            { name: "error", event: "wcs-worker:error" },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output derived from `error` (name + message); the existing
            // `error` property/event are unchanged. Fires wcs-worker:error-info-changed. No
            // lane — the worker is a command-driven owner, not a concurrent-operation node.
            { name: "errorInfo", event: "wcs-worker:error-info-changed" },
            { name: "running", event: "wcs-worker:running-changed" },
        ],
        commands: [
            { name: "start" },
            { name: "post" },
            { name: "terminate" },
        ],
    };
    _target;
    _worker = null;
    _message = null;
    _error = null;
    _errorInfo = null;
    _running = false;
    // Spawn configuration, retained so an automatic restart can re-spawn the same
    // script with the same options.
    _src = "";
    _type = "module";
    _name = "";
    // Restart-on-error bookkeeping (opt-in; bounded like WebSocketCore reconnect).
    // `_restartCount` is CUMULATIVE over the worker's lifetime: it counts every
    // restart since the last start() and is NOT reset by a period of stable
    // operation, so `_maxRestarts` bounds total restarts, not consecutive crashes.
    // It is reset to 0 only by start() (a fresh spawn / src switch).
    _restartOnError = false;
    _maxRestarts = Infinity;
    _restartInterval = 0;
    _restartCount = 0;
    _restartTimer = null;
    // Generation guard (§3.4): bumped on dispose() and captured at restart-timer
    // schedule time. A restart deferred via setTimeout is the Core's only async
    // work; if dispose() runs while it is pending, the stale timer MUST NOT
    // re-spawn a worker on a torn-down element. _clearRestartTimer() already
    // cancels the pending timer from inside the Core, so this guard is
    // defense-in-depth for any path that fires the callback after invalidation.
    _gen = 0;
    // SSR (§3.8): a worker is command-driven (spawned on start()), so there is no
    // asynchronous probe to await — readiness is immediate.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get ready() {
        return this._ready;
    }
    // Lifecycle (§3.5). The worker is command-driven (start/post/terminate), so
    // there is no subscription to establish up front: observe() is an idempotent
    // no-op that resolves once ready. dispose() (below) tears down the worker,
    // cancels any pending restart and invalidates in-flight async via _gen.
    observe() {
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
     * `wcs-worker:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
    }
    get running() {
        return this._running;
    }
    // --- State setters with event dispatch ---
    // Deliberately NO same-value guard. An incoming message is an event, not
    // idempotent state: the worker posting the same value twice is two distinct
    // occurrences and must re-fire wcs-worker:message each time so a `message:`
    // binding and any `eventToken.message:` subscriber see both.
    _setMessage(message) {
        this._message = message;
        this._target.dispatchEvent(new CustomEvent("wcs-worker:message", {
            detail: message,
            bubbles: true,
        }));
    }
    // Same-value guard. `error` has no derived state, so suppressing redundant
    // null→null dispatches (e.g. a successful spawn clearing an already-null error)
    // avoids spurious events. Reference identity suffices: each failure builds a
    // fresh object and the clear path always passes null.
    _setError(error) {
        if (this._error === error)
            return;
        this._error = error;
        // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the
        // normalized error (name + message), or null on clear. Fires before the `error`
        // event so an observer binding both sees the classification first, mirroring the
        // io-node family.
        this._commitErrorInfo(error === null ? null : deriveWorkerErrorInfo(error));
        this._target.dispatchEvent(new CustomEvent("wcs-worker:error", {
            detail: error,
            bubbles: true,
        }));
    }
    // Called only from _setError (which already same-value-guards on the error
    // reference), so errorInfo transitions exactly when error does — no separate
    // guard needed here.
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-worker:error-info-changed", {
            detail: info,
            bubbles: true,
        }));
    }
    // No same-value guard needed: every spawn (`start`, restart) goes through
    // `_spawn` (false→true) only after `_terminateWorker` (true→false, guarded by
    // `_worker`), so `running` only ever moves on a real transition.
    _setRunning(running) {
        this._running = running;
        this._target.dispatchEvent(new CustomEvent("wcs-worker:running-changed", {
            detail: running,
            bubbles: true,
        }));
    }
    // --- Public API ---
    /**
     * Spawn the worker from `src`. Any previously-spawned worker is terminated
     * first, so calling `start()` again with a different `src` switches scripts.
     * Idempotent on the same `src` (re-spawning the script we are already running
     * is pure churn) — this also absorbs the custom-element upgrade path where a
     * connected element with a `src` attribute triggers both
     * attributeChangedCallback and connectedCallback, calling start() twice. A
     * consequence of this guard: changing only the options (`type`, `name`,
     * restart-*) while running the same `src` is ignored — call `terminate()`
     * then `start()` to re-spawn with new options. Never throws: a spawn failure
     * surfaces through `error`.
     */
    start(src, options = {}) {
        if (!src) {
            this._setError({ name: "TypeError", message: "src is required." });
            return;
        }
        if (this._worker && this._src === src)
            return;
        this._clearRestartTimer();
        this._terminateWorker();
        this._src = src;
        this._type = options.type ?? "module";
        this._name = options.name ?? "";
        this._restartOnError = options.restartOnError ?? false;
        this._maxRestarts = options.maxRestarts ?? Infinity;
        this._restartInterval = options.restartInterval ?? 0;
        this._restartCount = 0;
        this._setError(null);
        this._spawn();
    }
    /**
     * Post a structured-cloneable value to the worker. The optional `transfer`
     * list moves ownership of `Transferable`s (ArrayBuffer, MessagePort, ...) — the
     * escape hatch the declarative layer cannot express. Never throws: a
     * non-cloneable value surfaces as `DataCloneError` and posting with no running
     * worker surfaces an `InvalidStateError`, both through `error`.
     */
    post(data, transfer) {
        if (!this._worker) {
            this._setError({
                name: "InvalidStateError",
                message: "Worker is not running. Call start(src) before post().",
            });
            return;
        }
        try {
            if (transfer && transfer.length > 0) {
                this._worker.postMessage(data, transfer);
            }
            else {
                this._worker.postMessage(data);
            }
        }
        catch (err) {
            this._setError(this._normalizeError(err));
        }
    }
    /** Terminate the worker. Idempotent — a no-op when none is running. */
    terminate() {
        this._clearRestartTimer();
        this._terminateWorker();
    }
    /**
     * Tear the Core down for a disconnected Shell: terminate the worker and reset
     * the error shadow (both `error` and its derived `errorInfo`). Only that
     * error/errorInfo clear is silent — it mutates the shadows without dispatching.
     * Terminating a *running* worker still dispatches
     * `wcs-worker:running-changed` (true→false) via `_terminateWorker`, so a
     * dispose on a worker that was live does emit one event on the (now
     * disconnected) element; only a no-op dispose (no worker running) is fully
     * silent.
     *
     * Asymmetry by design: `_message` is deliberately NOT reset. `error` is
     * transient state — a stale error from a previous worker would mislead after a
     * reconnect, so it is cleared. `message` is the last value received (an event
     * payload); it is retained as the Core's last-known datum and is naturally
     * overwritten by the next incoming message.
     */
    dispose() {
        // §3.4: invalidate any in-flight async (a pending restart timer) before
        // tearing down, so a stale timer that somehow fires cannot re-spawn.
        this._gen++;
        this._clearRestartTimer();
        this._terminateWorker();
        // Silent shadow reset (no dispatch), mirroring `_error`: keep `errorInfo`'s
        // clear-to-null invariant so a reconnect does not read a stale classification.
        this._error = null;
        this._errorInfo = null;
    }
    // --- Internal ---
    _spawn() {
        try {
            this._worker = new Worker(this._src, { type: this._type, name: this._name || undefined });
        }
        catch (err) {
            this._setError(this._normalizeError(err));
            return;
        }
        this._worker.addEventListener("message", this._onMessage);
        this._worker.addEventListener("messageerror", this._onMessageError);
        this._worker.addEventListener("error", this._onError);
        this._setRunning(true);
    }
    _onMessage = (event) => {
        this._setMessage(event.data);
    };
    // Fired when the worker posted a value this context cannot deserialize. The
    // event carries no usable payload, so report a synthetic DataError.
    _onMessageError = () => {
        this._setError({
            name: "DataError",
            message: "Failed to deserialize a message received from the worker.",
        });
    };
    // An uncaught error inside the worker script. The worker itself stays alive
    // (the platform does not auto-terminate it), so restart-on-error explicitly
    // re-spawns a fresh worker when enabled and the bound is not exhausted.
    _onError = (event) => {
        this._setError({
            name: "Error",
            message: event.message || "Worker script error.",
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
        });
        if (this._restartOnError && this._restartCount < this._maxRestarts) {
            this._scheduleRestart();
        }
    };
    _scheduleRestart() {
        this._clearRestartTimer();
        const gen = this._gen;
        this._restartTimer = setTimeout(() => {
            // §3.4: a dispose() between scheduling and firing bumps _gen; skip the
            // re-spawn so a torn-down Core does not resurrect a worker.
            if (gen !== this._gen)
                return;
            this._restartTimer = null;
            this._restartCount++;
            this._terminateWorker();
            // Clear the crash error BEFORE re-spawning so a successful restart leaves a
            // consistent running=true / error=null state (an `error` binding must not
            // keep showing the previous script's failure once the fresh worker is live).
            // Order matters: _spawn() re-sets `error` if the new spawn itself fails, so
            // a failed restart still surfaces its own error rather than null.
            this._setError(null);
            this._spawn();
        }, this._restartInterval);
    }
    _clearRestartTimer() {
        if (this._restartTimer !== null) {
            clearTimeout(this._restartTimer);
            this._restartTimer = null;
        }
    }
    _terminateWorker() {
        if (!this._worker)
            return;
        this._worker.removeEventListener("message", this._onMessage);
        this._worker.removeEventListener("messageerror", this._onMessageError);
        this._worker.removeEventListener("error", this._onError);
        this._worker.terminate();
        this._worker = null;
        this._setRunning(false);
    }
    _normalizeError(err) {
        if (err instanceof Error) {
            // DOMException is an Error subclass; its `name` (DataCloneError, etc.) is
            // the meaningful discriminator for consumers switching on failure kind.
            return { name: err.name, message: err.message };
        }
        return { name: "Error", message: String(err) };
    }
}

let registered = false;
// Attribute names for the optional post-on-click DOM trigger (clipboard.js-style
// DX). The element carrying `data-worker-target` points at a <wcs-worker> by id;
// the payload to post comes from either a literal `data-worker-text` or a
// `data-worker-from` CSS selector resolving to a source element.
const TEXT_ATTRIBUTE = "data-worker-text";
const FROM_ATTRIBUTE = "data-worker-from";
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
    // bare `:not()`), which makes querySelector throw a SyntaxError. Swallow it and
    // treat the source as unresolvable — the same "nothing to post" path as a
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
    // `data-worker-from` at; everything else falls through to textContent.
    if (source instanceof HTMLInputElement ||
        source instanceof HTMLTextAreaElement ||
        source instanceof HTMLSelectElement) {
        return source.value;
    }
    // `?? ""` is defensive: per the DOM spec only Document / DocumentType /
    // Notation nodes have a null `textContent`, and querySelector only ever returns
    // an Element (whose textContent is always a string). The branch is therefore
    // unreachable in practice and kept solely for the `string | null` type — not
    // worth a contrived test.
    return source.textContent ?? "";
}
function handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element))
        return;
    const triggerElement = target.closest(`[${config.triggerAttribute}]`);
    if (!triggerElement)
        return;
    const workerId = triggerElement.getAttribute(config.triggerAttribute);
    if (!workerId)
        return;
    // Resolve the registered constructor at call time instead of importing
    // WcsWorker as a value (avoids a components ⇄ autoTrigger import cycle:
    // Worker.connectedCallback() calls registerAutoTrigger()). instanceof against
    // the customElements registry keeps the same identity guarantee.
    const WorkerCtor = customElements.get(config.tagNames.worker);
    const workerElement = document.getElementById(workerId);
    if (!WorkerCtor || !(workerElement instanceof WorkerCtor))
        return;
    const text = resolveText(triggerElement);
    // No resolvable source: leave the click alone (do not preventDefault) so the
    // element's default action is unaffected.
    if (text === null)
        return;
    // Suppress the default action so a post can run without navigating. Intentional:
    // do not attach data-worker-target to an element whose default action you also
    // want (a real <a href> link). See README "Optional DOM Triggering".
    event.preventDefault();
    workerElement.post(text);
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

// Named WcsWorker (not `Worker`) to avoid shadowing the global `Worker`
// constructor and to match the <wcs-broadcast> WcsBroadcast / <wcs-ws>
// WcsWebSocket convention.
class WcsWorker extends HTMLElement {
    // SSR (§4.1/§4.4): expose connectedCallbackPromise backed by _core.observe()
    // so a shell renderer can await first-connect readiness uniformly across all
    // IO nodes. The worker still spawns synchronously in connectedCallback; the
    // Core's observe() resolves immediately (command-driven, no async probe), so
    // the promise is effectively already-resolved but the contract is honored.
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...WorkerCore.wcBindable,
        // Shell-level settable surface. `src` selects the script; `manual` suppresses
        // auto-spawn; `keep-alive` keeps the worker past disconnect; the restart-*
        // inputs configure opt-in restart-on-error. There is no momentary `post`
        // property: posting needs an argument (the payload), so element actions run
        // via command-token (`command.post: $command.ping`) or the DOM autoTrigger,
        // keeping `post` a plain command and the `command.post:` wiring readable.
        inputs: [
            { name: "src", attribute: "src" },
            { name: "type", attribute: "type" },
            { name: "name", attribute: "name" },
            { name: "manual", attribute: "manual" },
            { name: "keepAlive", attribute: "keep-alive" },
            { name: "restartOnError", attribute: "restart-on-error" },
            { name: "maxRestarts", attribute: "max-restarts" },
            { name: "restartInterval", attribute: "restart-interval" },
        ],
        // Commands are identical to the Core's — the attribute accessors (src, type,
        // name, ...) do not collide with start/post/terminate.
        commands: WorkerCore.wcBindable.commands,
    };
    static get observedAttributes() { return ["src"]; }
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new WorkerCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-worker:running-changed": (d) => ({ running: d === true }),
            "wcs-worker:error": (d) => ({ error: d != null }),
        });
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
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
    get src() {
        return this.getAttribute("src") || "";
    }
    set src(value) {
        this.setAttribute("src", value);
    }
    get type() {
        return this.getAttribute("type") === "classic" ? "classic" : "module";
    }
    set type(value) {
        this.setAttribute("type", value);
    }
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
    get keepAlive() {
        return this.hasAttribute("keep-alive");
    }
    set keepAlive(value) {
        if (value) {
            this.setAttribute("keep-alive", "");
        }
        else {
            this.removeAttribute("keep-alive");
        }
    }
    get restartOnError() {
        return this.hasAttribute("restart-on-error");
    }
    set restartOnError(value) {
        if (value) {
            this.setAttribute("restart-on-error", "");
        }
        else {
            this.removeAttribute("restart-on-error");
        }
    }
    get maxRestarts() {
        const attr = this.getAttribute("max-restarts");
        // `max-restarts="Infinity"` is the documented default-equivalent for an
        // unbounded restart budget. parseInt("Infinity", 10) is NaN, so match it
        // explicitly rather than leaning on the NaN fallback (which would silently
        // break if that fallback ever changed). Any other non-numeric value still
        // falls back to Infinity via the NaN guard.
        if (attr === "Infinity")
            return Infinity;
        const parsed = attr ? parseInt(attr, 10) : Infinity;
        return Number.isNaN(parsed) ? Infinity : parsed;
    }
    set maxRestarts(value) {
        this.setAttribute("max-restarts", String(value));
    }
    get restartInterval() {
        const attr = this.getAttribute("restart-interval");
        const parsed = attr ? parseInt(attr, 10) : 0;
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    set restartInterval(value) {
        this.setAttribute("restart-interval", String(value));
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
    get running() {
        return this._core.running;
    }
    // --- Commands ---
    start() {
        // Delegate unconditionally — including the empty-`src` case — so the Core's
        // never-throw contract holds at the Shell boundary too: start("") raises a
        // TypeError through `error` rather than failing silently. The auto-spawn
        // paths (connectedCallback / attributeChangedCallback) already gate on a
        // non-empty `src`, so this only affects an explicit `el.start()` call.
        this._core.start(this.src, {
            type: this.type,
            name: this.name,
            restartOnError: this.restartOnError,
            maxRestarts: this.maxRestarts,
            restartInterval: this.restartInterval,
        });
    }
    post(data, transfer) {
        this._core.post(data, transfer);
    }
    terminate() {
        this._core.terminate();
    }
    // --- Lifecycle ---
    attributeChangedCallback(name, _oldValue, newValue) {
        if (name === "src" && this.isConnected && !this.manual && newValue) {
            this.start();
        }
    }
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        // SSR (§4.4): back connectedCallbackPromise with the Core's observe(). It
        // resolves immediately for this command-driven node, but wiring it keeps the
        // readiness contract uniform with the async-init IO nodes.
        this._connectedCallbackPromise = this._core.observe();
        if (!this.manual && this.src) {
            this.start();
        }
    }
    disconnectedCallback() {
        // Deliberately does NOT call unregisterAutoTrigger(). The autoTrigger click
        // listener is a single process-wide document listener (registerAutoTrigger
        // is idempotent), shared by every <wcs-worker> on the page — not owned by
        // this element. Tearing it down when the last element disconnects would
        // break a later-inserted trigger, so it is intentionally left installed for
        // the document's lifetime (one passive listener, negligible cost). This
        // mirrors <wcs-broadcast> / <wcs-clipboard>, which register but never
        // unregister either; unregisterAutoTrigger stays exported purely as a
        // symmetric teardown hook for tests / advanced manual control.
        //
        // keep-alive intentionally leaves the worker running past disconnect: the
        // worker outlives the element and ownership transfers to the caller, who must
        // call terminate() to free the thread. Without keep-alive the worker is torn
        // down like <wcs-ws> / <wcs-broadcast> close on disconnect.
        if (!this.keepAlive) {
            this._core.dispose();
        }
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.worker)) {
        customElements.define(config.tagNames.worker, WcsWorker);
    }
}

function bootstrapWorker(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { WCS_WORKER_ERROR_CODE, WcsWorker, WorkerCore, bootstrapWorker, getConfig };
//# sourceMappingURL=index.esm.js.map

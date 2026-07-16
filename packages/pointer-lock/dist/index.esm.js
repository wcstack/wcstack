const _config = {
    tagNames: {
        pointerLock: "wcs-pointer-lock",
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
 * pointerLockCapabilities.ts
 *
 * Pointer Lock node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。pointer-lock は referenced element を操作するモニタ的ノードで競合 operation
 * を持たないため lane は無く、error taxonomy(errorInfo)のみを採用する。
 *
 * `_setError` は合成 `{ message }`(target 未解決 / API 非対応)と caught 例外
 * (`NotAllowedError` / `TypeError` = user gesture 外の requestPointerLock 拒否)を混在
 * 受理する。呼出側が明示 `kind` を渡して合成側を曖昧さ無く分類し、caught は `.name` で
 * 分類する(fullscreen と同じ discriminator 方式)。
 */
/** 安定した pointer-lock error code(taxonomy)。値は公開キーとして固定。 */
const WCS_POINTER_LOCK_ERROR_CODE = {
    /** Pointer Lock API 非対応。 */
    CapabilityMissing: "capability-missing",
    /** target selector が要素に解決しない等の入力不備。 */
    InvalidArgument: "invalid-argument",
    /** `NotAllowedError` / `TypeError` — user gesture 外での要求拒否。 */
    NotAllowed: "not-allowed",
    /** その他の caught 例外。 */
    PointerLockError: "pointer-lock-error",
};
function messageOf(error) {
    return typeof error?.message === "string"
        ? error.message
        : String(error);
}
/**
 * pointer-lock の失敗を serializable な error taxonomy に写す。`kind` は合成エラーの
 * 呼出側が渡す明示 discriminator(`capability-missing` / `invalid-argument`)。未指定は
 * caught 例外を意味し、`.name` で分類する。`NotAllowedError` / `TypeError` は user
 * gesture 内で再試行すれば成功しうるため recoverable=true。
 */
function derivePointerLockErrorInfo(error, kind) {
    const message = messageOf(error);
    if (kind === "capability-missing") {
        return { code: WCS_POINTER_LOCK_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
    }
    if (kind === "invalid-argument") {
        return { code: WCS_POINTER_LOCK_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
    }
    const name = error?.name;
    if (name === "NotAllowedError" || name === "TypeError") {
        return { code: WCS_POINTER_LOCK_ERROR_CODE.NotAllowed, phase: "execute", recoverable: true, message };
    }
    return { code: WCS_POINTER_LOCK_ERROR_CODE.PointerLockError, phase: "execute", recoverable: false, message };
}

/**
 * Headless Pointer Lock primitive. A thin, framework-agnostic wrapper around
 * the Pointer Lock API (`Element.requestPointerLock()` /
 * `document.exitPointerLock()` / `document.pointerLockElement` / the
 * `document`-scoped `pointerlockchange` event) exposed through the
 * wc-bindable protocol.
 *
 * This Core follows the same basic pattern as `FullscreenCore`
 * (docs/fullscreen-tag-design.md, referenced by docs/pointer-lock-tag-design.md
 * §1): target resolution happens in the Shell, `pointerlockchange` is
 * subscribed on `document` (not on the target element) and each instance
 * self-filters by comparing `document.pointerLockElement` against its own
 * resolved target, API resolution is call-time (never cached) and probes the
 * standard name before the legacy (`webkit`-prefixed) name, and a single
 * Core-level `_gen` generation guard protects the asynchronous
 * `requestPointerLock()` call from stale resolution after dispose().
 *
 * Key difference from Fullscreen (docs/pointer-lock-tag-design.md §2):
 * `exitPointerLock()` is a *synchronous* platform API (it returns `void`, not
 * a `Promise`), so the Core's `exitPointerLock()` command is synchronous too
 * and carries no `_gen` guard of its own — it is wrapped in `try/catch` only
 * as a defensive measure (never-throw), not because it can go stale.
 *
 * Scope note (docs/pointer-lock-tag-design.md §3): `movementX`/`movementY`
 * are intentionally NOT exposed by this Core (v1 scope). They are
 * high-frequency `mousemove` data unsuited to the same-value-guarded
 * declarative `properties` surface; see the design doc for the rationale and
 * the planned `debounce`/`throttle`-based opt-in for a future version.
 */
class PointerLockCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        // `active`'s CustomEvent detail is the bare boolean value itself — no
        // getter needed (docs/pointer-lock-tag-design.md §2). This differs from
        // FullscreenCore's `{ active }`-shaped detail + getter.
        properties: [
            { name: "active", event: "wcs-pointer-lock:change" },
            // `error` / `errorInfo` are observable failure outputs. Historically `error`
            // was an imperative getter with no event; both are now bindable (event-backed)
            // so `data-wcs` / bind() can observe a request/exit failure. `errorInfo` is the
            // additive serializable taxonomy (stable code / phase / recoverable) derived
            // from `error`; the `error` value shape is unchanged. No lane — pointer-lock
            // drives a referenced element, not a competing operation.
            { name: "error", event: "wcs-pointer-lock:error" },
            { name: "errorInfo", event: "wcs-pointer-lock:error-info-changed" },
        ],
        commands: [
            { name: "requestPointerLock", async: true },
            // Synchronous platform API (document.exitPointerLock() returns void) —
            // no `async` flag (docs/pointer-lock-tag-design.md §2).
            { name: "exitPointerLock" },
        ],
    };
    _target;
    _active = false;
    _error = null;
    _errorInfo = null;
    // The element this instance last resolved requestPointerLock()/observe()
    // against, kept so the document-scoped `pointerlockchange` handler can
    // self-filter under multiple concurrent instances (docs/fullscreen-tag-design.md
    // §2.1, inherited verbatim by pointer-lock per docs/pointer-lock-tag-design.md §1).
    _resolvedTarget = null;
    // True once observe() has attached the live `document` listener. Guards
    // observe() so a redundant call does not re-subscribe; dispose() resets it
    // so a later observe() resumes cleanly.
    _subscribed = false;
    // Core-level generation guard (§3.4 of the guidelines / §6 of
    // fullscreen-tag-design.md): only requestPointerLock() is asynchronous and
    // needs it. exitPointerLock() is synchronous and has no stale-resolution
    // race to guard against.
    _gen = 0;
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
    get active() {
        return this._active;
    }
    get error() {
        return this._error;
    }
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-pointer-lock:error-info-changed`), derived from `error`; the existing
     * `error` value shape is unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
    }
    // Lifecycle (§3.5). Idempotent: a second observe() while already subscribed
    // updates the tracked resolved target without re-subscribing to `document`.
    observe(target) {
        this._resolvedTarget = target;
        if (!this._subscribed) {
            this._subscribed = true;
            document.addEventListener(this._pointerLockChangeEventName(), this._onChange);
        }
        this._applyActive();
        return this._ready;
    }
    dispose() {
        this._gen++; // invalidate any in-flight requestPointerLock() resolution
        if (this._subscribed) {
            this._subscribed = false;
            document.removeEventListener(this._pointerLockChangeEventName(), this._onChange);
        }
        this._resolvedTarget = null;
    }
    /**
     * Request pointer lock on `element`. Never-throw: a missing API or a
     * rejected promise (e.g. called outside a user-gesture context —
     * `NotAllowedError`, docs/fullscreen-tag-design.md §3) is captured into
     * `error` rather than propagated. `element` may be `null` when the Shell's
     * `target` selector did not resolve (docs/pointer-lock-tag-design.md §1
     * defers error representation to FullscreenCore verbatim — this null-target
     * case mirrors `FullscreenCore.requestFullscreen(null)`,
     * docs/fullscreen-tag-design.md §6): distinct from "API is not supported"
     * below, so a typo'd selector doesn't masquerade as an unsupported platform.
     */
    async requestPointerLock(element) {
        const gen = ++this._gen;
        this._resolvedTarget = element;
        if (!element) {
            this._setError({ message: "Pointer Lock target could not be resolved." }, "invalid-argument");
            return;
        }
        const fn = this._requestPointerLockFn(element);
        if (!fn) {
            // Resolved synchronously in the same tick as the call — dispose()
            // cannot have run yet, so no staleness check is needed here (matches
            // the reference `requestFullscreen()` implementation,
            // docs/fullscreen-tag-design.md §6).
            this._setError({ message: "Pointer Lock API is not supported." }, "capability-missing");
            return;
        }
        try {
            // fn is already bound to `element` by _requestPointerLockFn().
            await fn();
            if (gen !== this._gen)
                return; // stale
            this._setError(null);
            this._applyActive();
        }
        catch (e) {
            if (gen !== this._gen)
                return; // stale
            this._setError(e);
        }
    }
    /**
     * Exit pointer lock. Synchronous platform API (docs/pointer-lock-tag-design.md
     * §2) — returns `void`, not a `Promise`. Silent no-op when nothing is
     * currently locked or the API is unsupported (mirrors
     * `FullscreenCore.exitFullscreen()`'s no-op contract,
     * docs/fullscreen-tag-design.md §7). Wrapped in try/catch defensively: even
     * though the platform API is synchronous and documented as not throwing in
     * this case, a synchronous throw from a non-conformant/fake implementation
     * must never escape (never-throw).
     */
    exitPointerLock() {
        try {
            if (this._pointerLockElement() === null)
                return; // already unlocked: silent no-op
            const fn = this._exitPointerLockFn();
            if (!fn)
                return; // unsupported: silent no-op (semantically already "not locked")
            fn();
            this._setError(null);
            this._applyActive();
        }
        catch (e) {
            this._setError(e);
        }
    }
    // --- API resolution (call-time, never cached — §3.7) ---
    // Resolved from `Element.prototype` rather than `el.requestPointerLock`
    // directly: when `target="self"`, `el` is the `<wcs-pointer-lock>` Shell
    // itself, whose own class declares an instance method also named
    // `requestPointerLock()` (the wcBindable command). Reading the property off
    // the instance would pick up that Shell method instead of the native
    // platform API and recurse infinitely (Shell.requestPointerLock() ->
    // Core.requestPointerLock() -> resolves "el.requestPointerLock" -> the same
    // Shell method again). Going through `Element.prototype` sidesteps the name
    // collision — note this does NOT pick up an override on a subclass's own
    // prototype (e.g. `WcsPointerLock.prototype`); it deliberately jumps
    // straight to the platform-defined layer. Both the standard and legacy name
    // are resolved the same way, for symmetry — matching FullscreenCore's
    // `_elementFullscreenFn` (docs/fullscreen-tag-design.md §4) ONLY in that one
    // respect. Unlike that Core, this one does not check `el`'s own properties
    // first: there is no test-stub/per-element monkey-patch path to accommodate
    // here (mocks.ts installs the fakes directly on `Element.prototype`), so it
    // goes straight there for both names.
    _requestPointerLockFn(el) {
        const proto = Element.prototype;
        const standard = proto.requestPointerLock;
        if (typeof standard === "function")
            return standard.bind(el);
        const legacy = proto.webkitRequestPointerLock;
        return typeof legacy === "function" ? legacy.bind(el) : undefined;
    }
    _exitPointerLockFn() {
        const d = document;
        return d.exitPointerLock?.bind(document) ?? d.webkitExitPointerLock?.bind(document);
    }
    _pointerLockElement() {
        const d = document;
        return d.pointerLockElement ?? d.webkitPointerLockElement ?? null;
    }
    // NOTE (test-environment caveat, not a production concern): happy-dom
    // always implements `document.onpointerlockchange` (as `null`) regardless
    // of which fake API surface a test installs, so `"onpointerlockchange" in
    // document` can never observably be `false` under this test runner and the
    // `webkitpointerlockchange` branch below cannot be driven through
    // `observe()` in a unit test. The branch is still correct and required for
    // real legacy WebKit builds that lack `onpointerlockchange` entirely — kept
    // as documented, deliberate, untestable-in-this-harness code per
    // docs/pointer-lock-tag-design.md.
    /* v8 ignore next 3 */
    _pointerLockChangeEventName() {
        return "onpointerlockchange" in document ? "pointerlockchange" : "webkitpointerlockchange";
    }
    _onChange = () => {
        this._applyActive();
    };
    // Self-filter (docs/fullscreen-tag-design.md §2.1): compares against this
    // instance's own resolved target, not merely "is *something* locked" — so
    // multiple concurrent instances each report the correct `active` value.
    _applyActive() {
        const next = this._resolvedTarget !== null && this._pointerLockElement() === this._resolvedTarget;
        this._setActive(next);
    }
    // Same-value guard (MUST, §3.3 of the guidelines). detail itself is the
    // bare boolean value (no getter needed) per docs/pointer-lock-tag-design.md
    // §2 — unlike FullscreenCore's `{ active }`-shaped detail + getter.
    _setActive(v) {
        if (this._active === v)
            return;
        this._active = v;
        this._target.dispatchEvent(new CustomEvent("wcs-pointer-lock:change", {
            detail: v,
            bubbles: true,
        }));
    }
    // `kind` is an explicit taxonomy discriminator passed only from the synthetic
    // error sites (unsupported / unresolved target); caught exceptions pass no kind
    // and are classified by their `.name`. Both `error` and the additive `errorInfo`
    // are now event-backed so a request/exit failure is observable via bind().
    _setError(error, kind) {
        // Same-value guard on reference: each failure builds a fresh object and the
        // clear path passes the literal null, so this only suppresses redundant
        // null→null (a successful request/exit clearing an already-null error).
        if (this._error === error)
            return;
        this._error = error;
        // Keep the additive errorInfo taxonomy in sync; fire it before the `error`
        // event so an observer of both sees the classification first (io-node family).
        this._commitErrorInfo(error === null ? null : derivePointerLockErrorInfo(error, kind));
        this._target.dispatchEvent(new CustomEvent("wcs-pointer-lock:error", {
            detail: error,
            bubbles: true,
        }));
    }
    // Called only from _setError (already reference-guarded), so errorInfo
    // transitions exactly when error does — no separate guard needed here.
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-pointer-lock:error-info-changed", {
            detail: info,
            bubbles: true,
        }));
    }
}

/**
 * `<wcs-pointer-lock target="...">` — declarative Pointer Lock API control.
 *
 * Like `<wcs-fullscreen>` (docs/fullscreen-tag-design.md §0), this Shell does
 * not lock itself — it operates on a *referenced* element via the `target`
 * attribute, using the same 3-mode resolution rule as `intersection`
 * (`_resolveTarget()`/`_safeQuery()`, copied verbatim per
 * docs/pointer-lock-tag-design.md §1 / docs/fullscreen-tag-design.md §1):
 *
 * | `target`        | operates on            | display     |
 * |-----------------|-------------------------|-------------|
 * | omitted         | first element child     | `contents`  |
 * | `"#selector"`    | the matched element      | `none`      |
 * | `"self"`         | the element itself       | `block`     |
 *
 * `requestPointerLock()` requires a user-gesture context (docs/fullscreen-tag-design.md
 * §3) — the primary activation path is the command-token protocol
 * (`command.requestPointerLock: $command.<token>` on `<wcs-pointer-lock>`,
 * emitted by a button's `onclick: $command.<token>`), not an
 * autoTrigger attribute (none is provided in v1,
 * docs/pointer-lock-tag-design.md §4).
 *
 * `movementX`/`movementY` are intentionally out of scope for v1
 * (docs/pointer-lock-tag-design.md §3) — do not add them without revisiting
 * the design doc.
 */
class WcsPointerLock extends HTMLElement {
    // SSR (§4.4): the Core subscribes synchronously on connect, but the Shell
    // still exposes connectedCallbackPromise so the state binder can await it
    // uniformly across all IO nodes before snapshotting.
    static hasConnectedCallbackPromise = true;
    static observedAttributes = ["target"];
    static wcBindable = {
        ...PointerLockCore.wcBindable,
        inputs: [{ name: "target", attribute: "target" }],
        // Core の commands をそのまま継承（単一情報源）。network/intersection と同型。
        commands: PointerLockCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new PointerLockCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-pointer-lock:change": (d) => ({ active: d === true }),
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
        // never-throw (docs/custom-state-reflection-design.md §3.6): attachInternals
        // is absent in happy-dom / older environments, and pre-125 Chromium rejects
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
    get target() {
        return this.getAttribute("target") ?? "";
    }
    set target(value) {
        this.setAttribute("target", value);
    }
    // --- Core delegated getters ---
    get active() {
        return this._core.active;
    }
    get error() {
        return this._core.error;
    }
    get errorInfo() {
        return this._core.errorInfo;
    }
    // --- Commands ---
    /**
     * Resolve `target` and request pointer lock on it. Requires a user-gesture
     * context. never-throw: an unresolvable target or an unsupported/rejected
     * API call are both surfaced via `error`, never thrown (mirrors
     * `<wcs-fullscreen>`'s `requestFullscreen()`, docs/fullscreen-tag-design.md
     * §3/§6 — the Shell passes the (possibly `null`) resolved element straight
     * through and lets the Core set `error`, rather than silently no-op'ing
     * here).
     */
    async requestPointerLock() {
        const { element } = this._resolveTarget();
        await this._core.requestPointerLock(element);
    }
    /** Exit pointer lock. Synchronous command — silent no-op if nothing is locked. */
    exitPointerLock() {
        this._core.exitPointerLock();
    }
    // --- Lifecycle ---
    connectedCallback() {
        this._applyDisplayAndObserve();
    }
    disconnectedCallback() {
        this._core.dispose();
    }
    attributeChangedCallback(name) {
        if (name === "target" && this.isConnected) {
            this._applyDisplayAndObserve();
        }
    }
    // --- Internal ---
    _applyDisplayAndObserve() {
        const { element, display } = this._resolveTarget();
        this.style.display = display;
        this._connectedCallbackPromise = this._core.observe(element);
    }
    // Copied verbatim from packages/intersection/src/components/Intersect.ts
    // (§1 of docs/pointer-lock-tag-design.md / docs/fullscreen-tag-design.md).
    _resolveTarget() {
        const target = this.target;
        if (target === "self") {
            return { element: this, display: "block" };
        }
        if (target !== "") {
            const scope = this.getRootNode();
            return { element: this._safeQuery(scope, target), display: "none" };
        }
        const child = this.firstElementChild;
        if (child) {
            return { element: child, display: "contents" };
        }
        return { element: this, display: "block" };
    }
    // Copied verbatim from packages/intersection/src/components/Intersect.ts.
    _safeQuery(scope, selector) {
        try {
            return scope.querySelector(selector);
        }
        catch {
            return null;
        }
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.pointerLock)) {
        customElements.define(config.tagNames.pointerLock, WcsPointerLock);
    }
}

function bootstrapPointerLock(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { PointerLockCore, WCS_POINTER_LOCK_ERROR_CODE, WcsPointerLock, bootstrapPointerLock, getConfig };
//# sourceMappingURL=index.esm.js.map

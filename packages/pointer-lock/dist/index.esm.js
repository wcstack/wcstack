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
     * `error` rather than propagated.
     */
    async requestPointerLock(element) {
        const gen = ++this._gen;
        this._resolvedTarget = element;
        const fn = this._requestPointerLockFn(element);
        if (!fn) {
            // Resolved synchronously in the same tick as the call — dispose()
            // cannot have run yet, so no staleness check is needed here (matches
            // the reference `requestFullscreen()` implementation,
            // docs/fullscreen-tag-design.md §6).
            this._setError({ message: "Pointer Lock API is not supported." });
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
    // Shell method again). Going through the prototype sidesteps the name
    // collision while still allowing a subclass to legitimately override the
    // platform method.
    _requestPointerLockFn(el) {
        const proto = Element.prototype;
        const standard = proto.requestPointerLock;
        if (typeof standard === "function")
            return standard.bind(el);
        const legacy = proto.webkitRequestPointerLock ?? el.webkitRequestPointerLock;
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
    _setError(e) {
        this._error = e;
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
 * (`command.click:$command.requestPointerLock` on a button), not an
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
    constructor() {
        super();
        this._core = new PointerLockCore(this);
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
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
    // --- Commands ---
    /** Request pointer lock on the resolved target. Requires a user-gesture context. */
    async requestPointerLock() {
        const { element } = this._resolveTarget();
        if (!element) {
            return;
        }
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

export { PointerLockCore, WcsPointerLock, bootstrapPointerLock, getConfig };
//# sourceMappingURL=index.esm.js.map

const _config = {
    tagNames: {
        pip: "wcs-pip",
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
 * pictureInPictureCapabilities.ts
 *
 * Picture-in-Picture node 固有の error code(taxonomy)と derivation。汎用の error
 * info 型は `./platformCapability.js`(/io-core/ から copy-distribution される生成
 * ファイル)から import する。Picture-in-Picture は referenced `<video>` を操作する
 * ノードで競合 operation を持たないため lane は無く、error taxonomy(errorInfo)のみを
 * 採用する(fullscreen と同型)。
 *
 * `_setError` は合成 `{ message }`(target が `<video>` に解決しない / API 非対応)と
 * caught 例外(`NotAllowedError` = user gesture 外の requestPictureInPicture 拒否等)を
 * 混在受理する。呼出側が明示 `kind` を渡して合成側を曖昧さ無く分類し、caught は `.name`
 * で分類する(fullscreen / storage / screen-orientation と同じ discriminator 方式)。
 */
/** 安定した Picture-in-Picture error code(taxonomy)。値は公開キーとして固定。 */
const WCS_PICTURE_IN_PICTURE_ERROR_CODE = {
    /** Picture-in-Picture API 非対応。 */
    CapabilityMissing: "capability-missing",
    /** target が `<video>` に解決しない等の入力不備。 */
    InvalidArgument: "invalid-argument",
    /** `NotAllowedError` / `TypeError` — user gesture 外での要求拒否。 */
    NotAllowed: "not-allowed",
    /** その他の caught 例外。 */
    PipError: "pip-error",
};
function messageOf(error) {
    return typeof error?.message === "string"
        ? error.message
        : String(error);
}
/**
 * Picture-in-Picture の失敗を serializable な error taxonomy に写す。`kind` は合成
 * エラーの呼出側が渡す明示 discriminator(`capability-missing` / `invalid-argument`)。
 * 未指定は caught 例外を意味し、`.name` で分類する。`NotAllowedError` / `TypeError` は
 * user gesture 内で再試行すれば成功しうるため recoverable=true。
 */
function derivePictureInPictureErrorInfo(error, kind) {
    const message = messageOf(error);
    if (kind === "capability-missing") {
        return { code: WCS_PICTURE_IN_PICTURE_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
    }
    if (kind === "invalid-argument") {
        return { code: WCS_PICTURE_IN_PICTURE_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
    }
    const name = error?.name;
    if (name === "NotAllowedError" || name === "TypeError") {
        return { code: WCS_PICTURE_IN_PICTURE_ERROR_CODE.NotAllowed, phase: "execute", recoverable: true, message };
    }
    return { code: WCS_PICTURE_IN_PICTURE_ERROR_CODE.PipError, phase: "execute", recoverable: false, message };
}

/**
 * Headless Picture-in-Picture primitive. A thin, framework-agnostic wrapper
 * around the classic Picture-in-Picture API
 * (`HTMLVideoElement.requestPictureInPicture()` / `document.exitPictureInPicture()` /
 * `document.pictureInPictureElement`) exposed through the wc-bindable protocol.
 *
 * This Core follows the same basic pattern as `@wcstack/fullscreen`'s
 * `FullscreenCore` (docs/fullscreen-tag-design.md): target resolution is done
 * by the Shell (this Core receives the resolved element at call time), API
 * resolution is call-time/non-cached, `_gen` is a single Core-level generation
 * guard, and `error` is a simple single field (no permission-style 4-value
 * state). See docs/picture-in-picture-tag-design.md for the differences from
 * Fullscreen:
 *
 * - **§2 target constraint**: the resolved target MUST be a `<video>` element.
 *   Picture-in-Picture is only defined as an instance method of
 *   `HTMLVideoElement` — unlike Fullscreen, which any `Element` supports. A
 *   non-`<video>` target is a never-throw failure: it is treated the same as
 *   an unresolved target and reported via `error`.
 * - **§3 event subscription target**: `enterpictureinpicture` /
 *   `leavepictureinpicture` fire on the `<video>` element itself, not on
 *   `document` (the reverse of Fullscreen's `document`-level
 *   `fullscreenchange`). The Core attaches/detaches these listeners directly
 *   on the resolved `<video>` element, re-wiring them whenever the target is
 *   re-resolved (e.g. the Shell's `target` attribute changes).
 */
class PipCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "active", event: "wcs-pip:change", getter: (e) => e.detail.active },
            // `error` / `errorInfo` are observable failure outputs. Historically `error`
            // was an imperative getter with no event; both are now bindable (event-backed)
            // so `data-wcs` / bind() can observe a request/exit failure. `errorInfo` is the
            // additive serializable taxonomy (stable code / phase / recoverable) derived
            // from `error`; the `error` value shape is unchanged. No lane — Picture-in-Picture
            // drives a referenced `<video>`, not a competing operation (fullscreen と同型)。
            { name: "error", event: "wcs-pip:error" },
            { name: "errorInfo", event: "wcs-pip:error-info-changed" },
        ],
        commands: [
            { name: "requestPictureInPicture", async: true },
            { name: "exitPictureInPicture", async: true },
        ],
    };
    _target;
    _active = false;
    _error = null;
    _errorInfo = null;
    // The <video> element the Core currently subscribes to for
    // enterpictureinpicture/leavepictureinpicture (null when unresolved/torn down).
    _video = null;
    // Generation guard (§3.4 / fullscreen-tag-design.md §6): bumped on dispose()
    // and each async command start. A completion that lands after dispose() (or
    // after a superseding call) is stale and MUST NOT write state.
    _gen = 0;
    // SSR (§3.8): no asynchronous probe to await, so readiness is immediate.
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
     * `wcs-pip:error-info-changed`), derived from `error`; the existing `error`
     * value shape is unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
    }
    // --- Lifecycle (§3.5) ---
    /**
     * (Re-)subscribe to `enterpictureinpicture`/`leavepictureinpicture` on
     * `element` (the Shell's resolved `<video>` target). Idempotent when called
     * again with the same element; re-wires the listeners when the element
     * changes (e.g. the `target` attribute was changed), detaching from the
     * previous element first so no stale listener lingers.
     */
    observe(element) {
        if (this._video === element) {
            return this._ready;
        }
        this._detach();
        this._video = element;
        if (element) {
            element.addEventListener("enterpictureinpicture", this._onEnter);
            element.addEventListener("leavepictureinpicture", this._onLeave);
        }
        this._syncActive();
        return this._ready;
    }
    dispose() {
        this._gen++;
        this._detach();
        this._video = null;
    }
    // --- Commands (§3.6 never-throw) ---
    /**
     * Request Picture-in-Picture for `element`. `element` must be a `<video>`
     * (checked before the gesture-context failure path, since a type mismatch is
     * an environment-independent, permanent error — docs/picture-in-picture-tag-design.md §2).
     * Never throws: all failures (wrong tag, unsupported API, gesture-context
     * rejection) are funneled into `error` and the returned promise resolves.
     */
    async requestPictureInPicture(element) {
        const gen = ++this._gen;
        if (!element || element.tagName !== "VIDEO") {
            // Distinct from "API is not supported" (below): the resolved target did
            // not satisfy the `<video>`-only constraint (wrong tag / unresolved).
            this._setError({ message: "target must be a <video> element." }, "invalid-argument");
            return;
        }
        // Re-wire to `element` before issuing the platform call: a caller may
        // request a <video> different from the one last passed to observe() (e.g.
        // the Shell's target attribute pointed at nothing at connect time and the
        // matching <video> was only inserted later, so no attributeChangedCallback
        // ever re-resolved it). Without this, `_video` stays stale and
        // `_syncActive()` below (and future enter/leave events) would never
        // recognize `element` as this Core's target, leaving `active` permanently
        // wrong even though the request succeeded (mirrors
        // FullscreenCore.requestFullscreen()'s unconditional `this._resolvedTarget
        // = element` assignment — docs/fullscreen-tag-design.md §6).
        this.observe(element);
        const fn = this._requestPictureInPictureFn(element);
        if (!fn) {
            this._setError({ message: "Picture-in-Picture API is not supported." }, "capability-missing");
            return;
        }
        try {
            await fn.call(element);
            if (gen !== this._gen)
                return; // stale
            this._setError(null);
            this._syncActive(); // belt-and-suspenders (mirrors FullscreenCore's _applyActive() on success)
        }
        catch (e) {
            if (gen !== this._gen)
                return; // stale
            this._setError(e); // e.g. NotAllowedError (gesture-context rejection)
        }
    }
    /**
     * Exit Picture-in-Picture. Mirrors FullscreenCore.exitFullscreen(): a
     * silent no-op (resolve, no error) when nothing is currently in
     * Picture-in-Picture — see fullscreen-tag-design.md §7.
     */
    async exitPictureInPicture() {
        // no-op checks come BEFORE the generation bump: a call that does nothing
        // must not supersede an in-flight requestPictureInPicture() — bumping
        // first would make the pending request's settle handling stale and
        // silently swallow its error update (mirrors
        // FullscreenCore.exitFullscreen()).
        if (this._pictureInPictureElement() === null)
            return; // already not in PiP: silent no-op
        const fn = this._exitPictureInPictureFn();
        if (!fn)
            return; // unsupported: silent no-op (semantically already "not in PiP")
        const gen = ++this._gen;
        try {
            await fn();
            if (gen !== this._gen)
                return;
            this._setError(null);
            this._syncActive(); // belt-and-suspenders (mirrors FullscreenCore.exitFullscreen()'s success-path _applyActive()); covers a delayed/dropped leavepictureinpicture
        }
        catch (e) {
            if (gen !== this._gen)
                return;
            this._setError(e);
        }
    }
    // --- Internal: API resolution (call-time, never cached — §3.7) ---
    // Unlike FullscreenCore's _elementFullscreenFn(), a naive direct property
    // lookup (`e.requestPictureInPicture`, walking the prototype chain) here is
    // safe: it cannot recurse into the Shell's own command method,
    // because the resolved target is validated to be a <video> element (§2)
    // before this is called, and <wcs-pip> (the Shell) is never itself a
    // <video>. Fullscreen's own→Element.prototype two-step resolution guards
    // against `target="self"`/no-target resolving to the Shell element, which
    // cannot happen here.
    _requestPictureInPictureFn(el) {
        const e = el;
        return typeof e.requestPictureInPicture === "function" ? e.requestPictureInPicture : undefined;
    }
    _exitPictureInPictureFn() {
        const d = document;
        return typeof d.exitPictureInPicture === "function" ? d.exitPictureInPicture.bind(document) : undefined;
    }
    _pictureInPictureElement() {
        const d = document;
        return d.pictureInPictureElement ?? null;
    }
    // --- Internal: event wiring ---
    _onEnter = () => {
        this._syncActive();
    };
    _onLeave = () => {
        this._syncActive();
    };
    _syncActive() {
        const isActive = this._video !== null && this._pictureInPictureElement() === this._video;
        this._setActive(isActive);
    }
    _detach() {
        if (this._video) {
            this._video.removeEventListener("enterpictureinpicture", this._onEnter);
            this._video.removeEventListener("leavepictureinpicture", this._onLeave);
        }
    }
    // --- State setters with event dispatch (§3.3 same-value guard) ---
    _setActive(active) {
        if (this._active === active)
            return;
        this._active = active;
        this._target.dispatchEvent(new CustomEvent("wcs-pip:change", {
            detail: { active },
            bubbles: true,
        }));
    }
    // `kind` is an explicit taxonomy discriminator passed only from the synthetic
    // error sites (unsupported / non-<video> target); caught exceptions pass no kind
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
        this._commitErrorInfo(error === null ? null : derivePictureInPictureErrorInfo(error, kind));
        this._target.dispatchEvent(new CustomEvent("wcs-pip:error", {
            detail: error,
            bubbles: true,
        }));
    }
    // Called only from _setError (already reference-guarded), so errorInfo
    // transitions exactly when error does — no separate guard needed here.
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-pip:error-info-changed", {
            detail: info,
            bubbles: true,
        }));
    }
}

/**
 * `<wcs-pip target="...">` — declarative Picture-in-Picture control.
 *
 * Like `<wcs-fullscreen>` (docs/fullscreen-tag-design.md §0/§1), this Shell
 * does not operate on itself: it is a non-visible control tag that resolves a
 * `target` element and invokes Picture-in-Picture commands against it. The
 * `target` attribute resolves in the same 3 modes as `intersection`/`fullscreen`
 * (`self` / a selector / the first element child), reused verbatim from
 * `@wcstack/intersection`'s `_resolveTarget()`/`_safeQuery()`
 * (packages/intersection/src/components/Intersect.ts).
 *
 * Picture-in-Picture-specific difference (docs/picture-in-picture-tag-design.md
 * §2): the resolved target must be a `<video>` element. This Shell resolves the
 * DOM element and hands it to the Core; the Core performs the `tagName ===
 * "VIDEO"` validation (never-throw — a mismatch is treated as an unresolved
 * target and reported via `error`, not thrown).
 */
class WcsPip extends HTMLElement {
    // SSR (§4.4): observe() completes synchronously, but the Shell still exposes
    // connectedCallbackPromise so the state binder can await it uniformly across
    // all IO nodes before snapshotting.
    static hasConnectedCallbackPromise = true;
    static observedAttributes = ["target"];
    static wcBindable = {
        ...PipCore.wcBindable,
        inputs: [{ name: "target", attribute: "target" }],
        // Core の commands をそのまま継承（単一情報源）。fullscreen/intersection と同型。
        commands: PipCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new PipCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-pip:change": (d) => ({ active: d?.active === true }),
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
        // never-throw (docs/custom-state-reflection-design.md §3.1): attachInternals
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
    get errorInfo() {
        return this._core.errorInfo;
    }
    // --- Commands ---
    async requestPictureInPicture() {
        const { element } = this._resolveVideoTarget();
        return this._core.requestPictureInPicture(element);
    }
    async exitPictureInPicture() {
        return this._core.exitPictureInPicture();
    }
    // --- Internal ---
    /**
     * `_resolveTarget()`/`_safeQuery()` copied verbatim from `@wcstack/intersection`
     * (packages/intersection/src/components/Intersect.ts:243-267, 281-287) per the
     * fullscreen/picture-in-picture batch's shared target-resolution archetype
     * (docs/fullscreen-tag-design.md §1).
     */
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
    _safeQuery(scope, selector) {
        try {
            return scope.querySelector(selector);
        }
        catch {
            return null;
        }
    }
    /**
     * Layers the Picture-in-Picture-specific `tagName === "VIDEO"` check on top
     * of `_resolveTarget()` (docs/picture-in-picture-tag-design.md §2). A
     * resolved-but-wrong-tag element is treated as unresolved (`element: null`)
     * so it flows into the same "target not found" failure path as Fullscreen's
     * missing-target case — never-throw, no exception escapes.
     */
    _resolveVideoTarget() {
        const { element, display } = this._resolveTarget();
        if (element !== null && element.tagName !== "VIDEO") {
            return { element: null, display };
        }
        return { element: element, display };
    }
    _observe() {
        const { element, display } = this._resolveVideoTarget();
        this.style.display = display;
        this._connectedCallbackPromise = this._core.observe(element);
    }
    // --- Lifecycle ---
    connectedCallback() {
        this._observe();
    }
    disconnectedCallback() {
        this._core.dispose();
    }
    attributeChangedCallback(_name, oldValue, newValue) {
        if (oldValue === newValue)
            return;
        if (!this.isConnected)
            return;
        this._observe();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.pip)) {
        customElements.define(config.tagNames.pip, WcsPip);
    }
}

function bootstrapPip(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { PipCore, WCS_PICTURE_IN_PICTURE_ERROR_CODE, WcsPip, bootstrapPip, getConfig };
//# sourceMappingURL=index.esm.js.map

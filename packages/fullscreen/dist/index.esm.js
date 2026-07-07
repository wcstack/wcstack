const _config = {
    tagNames: {
        fullscreen: "wcs-fullscreen",
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
 * Headless Fullscreen API primitive. Unlike most wcstack IO nodes, this Core
 * does not operate on itself: it drives `requestFullscreen()` /
 * `exitFullscreen()` on a *referenced* Element that the Shell resolves via its
 * `target` attribute (docs/fullscreen-tag-design.md §0). The Core only ever
 * receives already-resolved `Element`s from its callers — it has no opinion on
 * how `target` selectors are parsed.
 *
 * `document.fullscreenElement` is a single document-wide value, so this Core
 * always compares against the *last element it resolved* (via
 * `requestFullscreen()`/`setTarget()`), never against "is the document
 * fullscreen at all" — that comparison is what keeps multiple concurrent
 * `<wcs-fullscreen>` instances from all reporting the same `active` value
 * (docs/fullscreen-tag-design.md §2.1, MUST).
 */
class FullscreenCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "active", event: "wcs-fullscreen:change", getter: (e) => e.detail.active },
        ],
        commands: [
            { name: "requestFullscreen", async: true },
            { name: "exitFullscreen", async: true },
        ],
    };
    _target;
    _active = false;
    // Single error slot (§8): null means "no recent failure". Fullscreen's
    // gesture-rejection failure is a one-shot event, not a persistent state
    // machine like permission's 4-value surface — active/error are two
    // orthogonal, independently-observable axes.
    _error = null;
    // The last Element this Core resolved via requestFullscreen()/setTarget().
    // Compared against document.fullscreenElement on every fullscreenchange so
    // each instance judges only its own target (§2.1). null means "no target
    // resolved yet" — active must stay false in that case.
    _resolvedTarget = null;
    // Generation guard (§6): Core-scoped (one per Core, not per-target),
    // mirroring fetch/upload. document.fullscreenElement is a single
    // document-wide slot, so at most one in-flight request/exit is meaningful
    // per Core at a time.
    _gen = 0;
    // True once observe() has attached the document-level fullscreenchange
    // listener. Guards observe() so a redundant call does not double-subscribe;
    // dispose() resets it so a later observe() resumes cleanly.
    _subscribed = false;
    // SSR (§10): no asynchronous probe to await — observe() completes
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
     * Update the resolved target without issuing a fullscreen request (e.g. the
     * Shell re-resolves `target` on attribute change / connect). Re-evaluates
     * `active` against the current `document.fullscreenElement` so the state
     * stays correct even if the target changed while already fullscreen.
     */
    setTarget(element) {
        this._resolvedTarget = element;
        this._applyActive();
    }
    // Lifecycle (§10/§3.5). Idempotent: a second observe() while already
    // subscribed is a no-op (no double listener). Synchronous overall (no probe
    // to await), so the returned promise is only for API uniformity with other
    // IO nodes.
    observe() {
        if (!this._subscribed) {
            this._subscribed = true;
            document.addEventListener(this._fullscreenChangeEventName(), this._onFullscreenChange);
        }
        return this._ready;
    }
    dispose() {
        this._gen++;
        if (this._subscribed) {
            this._subscribed = false;
            document.removeEventListener(this._fullscreenChangeEventName(), this._onFullscreenChange);
        }
    }
    /**
     * Request fullscreen on `element`. never-throw (§3/§6): a missing API or a
     * rejected promise (e.g. a `TypeError` from a call outside a user
     * gesture, per the WHATWG Fullscreen spec's transient-activation check) is
     * caught and surfaced via `error`, never thrown. The caller
     * (Shell) is responsible for resolving `target` and for ensuring this is
     * invoked from within an actual user gesture — this Core cannot manufacture
     * one (docs/fullscreen-tag-design.md §3).
     */
    async requestFullscreen(element) {
        const gen = ++this._gen;
        this._resolvedTarget = element;
        if (!element) {
            // Distinct from "API is not supported" (below): the Shell's `target`
            // selector did not resolve to any element (missing/typo'd selector).
            // Conflating the two previously misled users into thinking Fullscreen
            // itself was unsupported when only their selector was wrong.
            this._setError({ message: "Fullscreen target could not be resolved." });
            return;
        }
        const fn = this._requestFullscreenFn(element);
        if (!fn) {
            this._setError({ message: "Fullscreen API is not supported." });
            return;
        }
        try {
            await fn.call(element);
            if (gen !== this._gen)
                return; // stale: dispose()/superseding call ran
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
     * Exit fullscreen. Silent no-op (§7) when nothing is currently fullscreen or
     * the API is unsupported — both are treated as "already achieved the exit
     * intent", not as errors, keeping repeated calls safe and never-throw.
     */
    async exitFullscreen() {
        // no-op checks come BEFORE the generation bump: a call that does nothing
        // must not supersede an in-flight requestFullscreen() — bumping first
        // would make the pending request's settle handling stale and silently
        // swallow its error/active updates.
        if (this._fullscreenElement() === null)
            return; // already not fullscreen: silent no-op
        const fn = this._exitFullscreenFn();
        if (!fn)
            return; // unsupported: silent no-op (semantically already "not fullscreen")
        const gen = ++this._gen;
        try {
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
    // --- API resolution layer (§4): call-time, never cached. Lets tests
    // install/remove the standard/legacy APIs freely and lets an unsupported
    // environment be detected correctly on every call. ---
    _requestFullscreenFn(el) {
        return this._elementFullscreenFn(el, "requestFullscreen")
            ?? this._elementFullscreenFn(el, "webkitRequestFullscreen");
    }
    // Resolve a fullscreen method for `el` WITHOUT a naive `el[name]` lookup.
    // A plain lookup walks the whole prototype chain — and <wcs-fullscreen>
    // itself declares a `requestFullscreen()` *command* method, so when the
    // resolved target is the Shell element (target="self", or target omitted
    // with no children), the naive lookup would find the Shell's own command
    // instead of the platform API and recurse infinitely (stack overflow).
    // Instead: check the element's own properties (how tests install stubs —
    // happy-dom has no Fullscreen API — and how a deliberate per-element
    // monkey-patch would appear), then jump straight to Element.prototype,
    // where the platform defines the real methods. Both the standard and the
    // legacy webkit name go through this same resolution for symmetry.
    _elementFullscreenFn(el, name) {
        if (Object.prototype.hasOwnProperty.call(el, name)) {
            return el[name];
        }
        return Element.prototype[name];
    }
    _exitFullscreenFn() {
        const d = document;
        return d.exitFullscreen?.bind(document) ?? d.webkitExitFullscreen?.bind(document);
    }
    _fullscreenElement() {
        const d = document;
        return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
    }
    _fullscreenChangeEventName() {
        return "onfullscreenchange" in document ? "fullscreenchange" : "webkitfullscreenchange";
    }
    // --- Internal ---
    _onFullscreenChange = () => {
        this._applyActive();
    };
    // Re-derive `active` by comparing document.fullscreenElement (incl. legacy
    // fallback) against *this instance's* resolved target (§2/§2.1/§5). A null
    // resolved target always yields active=false — there is nothing for this
    // instance to claim as "mine".
    _applyActive() {
        const next = this._resolvedTarget !== null && this._fullscreenElement() === this._resolvedTarget;
        this._setActive(next);
    }
    _setActive(v) {
        if (this._active === v)
            return; // same-value guard (§3.3 MUST)
        this._active = v;
        this._target.dispatchEvent(new CustomEvent("wcs-fullscreen:change", {
            detail: { active: v },
            bubbles: true,
        }));
    }
    _setError(error) {
        this._error = error;
    }
}

/**
 * `<wcs-fullscreen target="...">` — declarative Fullscreen API control.
 *
 * Like `intersection`/`resize`, this Shell operates on a *referenced* element,
 * not itself (docs/fullscreen-tag-design.md §0): `target` resolves which
 * element `requestFullscreen()`/`exitFullscreen()` are invoked on, using the
 * exact same 3-mode resolution as `<wcs-intersect>`
 * (docs/fullscreen-tag-design.md §1):
 *
 * | `target`        | operates on            | display     | use case                |
 * |-----------------|-------------------------|-------------|--------------------------|
 * | omitted         | first element child     | `contents`  | wrap a gallery image/video |
 * | `"#hero"` / sel | the matched element      | `none`      | point at a distant node  |
 * | `"self"`        | the element itself       | `block`     | fullscreen the wrapper   |
 *
 * `requestFullscreen()` requires an active user gesture — this element cannot
 * manufacture one. Invoke the command from within a real click handler
 * (typically via the command-token protocol: this element subscribes with
 * `command.requestFullscreen: $command.<token>`, and a button emits the
 * token from its own click handler, e.g. `onclick: $command.<token>`).
 */
class WcsFullscreen extends HTMLElement {
    // SSR (§10): the fullscreenchange subscription is established synchronously
    // on connect, but the Shell still exposes connectedCallbackPromise so the
    // state binder can await it uniformly across all IO nodes before
    // snapshotting.
    static hasConnectedCallbackPromise = true;
    static observedAttributes = ["target"];
    static wcBindable = {
        ...FullscreenCore.wcBindable,
        inputs: [{ name: "target", attribute: "target" }],
        // Core の commands をそのまま継承（単一情報源）。network/intersection と同型。
        commands: FullscreenCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    constructor() {
        super();
        this._core = new FullscreenCore(this);
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
    /**
     * Resolve `target` and request fullscreen on it. never-throw: an
     * unresolvable target or an unsupported/rejected API call are both
     * surfaced via `error`, never thrown (docs/fullscreen-tag-design.md §3/§6).
     */
    async requestFullscreen() {
        const { element } = this._resolveTarget();
        await this._core.requestFullscreen(element);
    }
    async exitFullscreen() {
        await this._core.exitFullscreen();
    }
    // --- Internal ---
    // Copied verbatim from <wcs-intersect> (Intersect.ts _resolveTarget/_safeQuery,
    // docs/fullscreen-tag-design.md §1): identical 3-mode resolution, only the
    // "what to do with the resolved element" step differs.
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
    _reresolve() {
        const { element, display } = this._resolveTarget();
        this.style.display = display;
        this._core.setTarget(element);
    }
    // --- Lifecycle ---
    connectedCallback() {
        this._reresolve();
        this._connectedCallbackPromise = this._core.observe();
    }
    disconnectedCallback() {
        this._core.dispose();
    }
    attributeChangedCallback(_name, oldValue, newValue) {
        if (oldValue === newValue)
            return;
        if (!this.isConnected)
            return;
        this._reresolve();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.fullscreen)) {
        customElements.define(config.tagNames.fullscreen, WcsFullscreen);
    }
}

function bootstrapFullscreen(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { FullscreenCore, WcsFullscreen, bootstrapFullscreen, getConfig };
//# sourceMappingURL=index.esm.js.map

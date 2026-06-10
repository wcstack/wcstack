const _config = {
    tagNames: {
        resize: "wcs-resize",
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
 * Headless element-size primitive. A thin, framework-agnostic wrapper around the
 * ResizeObserver API exposed through the wc-bindable protocol.
 *
 * Like IntersectionCore, the thing being observed is a *DOM element* — so
 * `observe()` takes the target node. The Core stays DOM-resolution-agnostic: it
 * observes whatever element it is handed (the Shell resolves the `target` selector
 * before calling). It is a read-only producer — element/layout → state only.
 *
 * Every observer callback is published via the single `wcs-resize:change` event;
 * `width` / `height` are read from it through getters (mirroring how
 * IntersectionCore derives `intersecting` / `ratio` from one event), so an observer
 * binding any of them is notified on every change.
 *
 * `width` / `height` follow the observed `box` (border-box / device-pixel /
 * content-box) and are rounded to integers when `round` is set — `round` absorbs
 * the sub-pixel jitter that would otherwise let a size→layout→size loop oscillate.
 *
 * Single-target by design: the Shell observes exactly one element, so the state
 * reflects that element. Multi-target observation is intentionally out of scope.
 */
class ResizeCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "entry", event: "wcs-resize:change" },
            { name: "width", event: "wcs-resize:change", getter: (e) => e.detail.width },
            { name: "height", event: "wcs-resize:change", getter: (e) => e.detail.height },
            { name: "observing", event: "wcs-resize:observing-changed" },
        ],
        commands: [
            { name: "observe" },
            { name: "unobserve" },
            { name: "disconnect" },
        ],
    };
    _target;
    // The live observer and the single element it observes. The *requested* options
    // are kept so a repeated observe() with identical options is a no-op (avoids the
    // create→observe→disconnect churn an autoloader upgrade can otherwise cause). It
    // is the requested box — not the effective one — so a re-observe of an unsupported
    // box (which falls back to content-box) still hits the idempotency guard instead
    // of rebuilding+falling-back every time. `_effectiveBox` separately tracks the box
    // actually in effect, which is what normalization reads.
    _observer = null;
    _observed = null;
    _options = {};
    _effectiveBox = "content-box";
    _entry = null;
    _observing = false;
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get entry() {
        return this._entry;
    }
    get width() {
        return this._entry ? this._entry.width : 0;
    }
    get height() {
        return this._entry ? this._entry.height : 0;
    }
    get observing() {
        return this._observing;
    }
    // --- State setters with event dispatch ---
    _setEntry(entry) {
        // No same-value guard: `change` carries event semantics (every callback is a
        // distinct observation) and `width` / `height` are derived getters that must
        // re-fire on each entry, mirroring IntersectionCore's `change`.
        this._entry = entry;
        this._target.dispatchEvent(new CustomEvent("wcs-resize:change", {
            detail: entry,
            bubbles: true,
        }));
    }
    _setObserving(observing) {
        if (this._observing === observing)
            return;
        this._observing = observing;
        this._target.dispatchEvent(new CustomEvent("wcs-resize:observing-changed", {
            detail: observing,
            bubbles: true,
        }));
    }
    // --- Public API ---
    /**
     * Start observing `element`. Idempotent while already observing the same element
     * with the same options. Changing the element or options tears down the current
     * observer and builds a new one (re-observing also re-delivers the initial size,
     * which is how a `round` toggle re-fires with the new rounding).
     *
     * If ResizeObserver is unavailable (SSR) this is a silent no-op — `observing`
     * stays false. If the requested `box` is unsupported, it retries once with
     * `content-box` before giving up; both giving-up paths leave `observing` false,
     * consistent with the never-throw design of the other @wcstack sensors.
     */
    observe(element, options = {}) {
        if (this._observer && this._observed === element && this._optionsEqual(this._options, options)) {
            return;
        }
        this._teardownObserver();
        const observer = this._createObserver();
        if (!observer) {
            // Unsupported environment (no ResizeObserver). If we were already observing,
            // that observation is now gone — reflect it rather than reporting a stale true.
            this._setObserving(false);
            return;
        }
        const effectiveBox = this._beginObserve(observer, element, options.box);
        if (effectiveBox === null) {
            // observe() threw even after the content-box fallback — no live observation.
            observer.disconnect();
            this._setObserving(false);
            return;
        }
        this._observer = observer;
        this._observed = element;
        // Store the *requested* options (raw) for the idempotency guard; `_effectiveBox`
        // holds the box that actually took effect (content-box after a fallback) for
        // normalization to read.
        this._options = { box: options.box, round: options.round };
        this._effectiveBox = effectiveBox;
        this._setObserving(true);
    }
    /**
     * Stop observing `element`. A no-op if it is not the currently observed element.
     * The observer instance is torn down (single-target Core), so a later observe()
     * rebuilds it.
     */
    unobserve(element) {
        if (this._observed !== element)
            return;
        this._teardownObserver();
        this._setObserving(false);
    }
    /** Stop all observation and release the observer. */
    disconnect() {
        this._teardownObserver();
        this._setObserving(false);
    }
    // --- Internal ---
    _teardownObserver() {
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
        this._observed = null;
    }
    _createObserver() {
        // No constructor try/catch: unlike IntersectionObserver (which validates
        // rootMargin at construction), the ResizeObserver constructor takes only a
        // callback and has no throwing precondition. The throw path is on observe()
        // (an unsupported `box`), handled in _beginObserve.
        if (typeof ResizeObserver === "undefined")
            return null;
        return new ResizeObserver(this._onResize);
    }
    /**
     * Start observing with the requested `box`, retrying once with `content-box` if
     * the runtime rejects the box (e.g. `device-pixel-content-box` on engines that do
     * not support it). Returns the box actually in effect, or `null` if observation
     * could not start at all.
     */
    _beginObserve(observer, element, box) {
        const requested = box ?? "content-box";
        try {
            observer.observe(element, { box: requested });
            return requested;
        }
        catch {
            // Already content-box and it still threw — nothing safer to fall back to.
            if (requested === "content-box")
                return null;
            try {
                observer.observe(element, { box: "content-box" });
                return "content-box";
            }
            catch {
                return null;
            }
        }
    }
    _onResize = (entries) => {
        for (const entry of entries) {
            this._setEntry(this._normalizeEntry(entry));
        }
    };
    _normalizeEntry(entry) {
        const contentRect = this._normalizeRect(entry.contentRect);
        const contentBoxSize = this._firstBoxSize(entry.contentBoxSize);
        const borderBoxSize = this._firstBoxSize(entry.borderBoxSize);
        // devicePixelContentBoxSize is Chromium-only; absent on other engines.
        const devicePixelContentBoxSize = this._firstBoxSize(entry.devicePixelContentBoxSize);
        const { width, height } = this._headlineSize(contentBoxSize, borderBoxSize, devicePixelContentBoxSize, contentRect);
        return {
            width,
            height,
            contentRect,
            contentBoxSize,
            borderBoxSize,
            devicePixelContentBoxSize,
            target: entry.target,
        };
    }
    /**
     * Pick the headline width/height from the boxSize matching the observed `box`,
     * falling back to `contentRect` when that fragment is absent (older engines only
     * fill contentRect). `inlineSize`/`blockSize` map to width/height (correct for
     * horizontal writing modes). Rounds to integers when `round` is set.
     */
    _headlineSize(contentBoxSize, borderBoxSize, devicePixelContentBoxSize, contentRect) {
        const box = this._effectiveBox;
        let size;
        if (box === "border-box") {
            size = borderBoxSize;
        }
        else if (box === "device-pixel-content-box") {
            size = devicePixelContentBoxSize;
        }
        else {
            size = contentBoxSize;
        }
        let width;
        let height;
        if (size) {
            width = size.inlineSize;
            height = size.blockSize;
        }
        else {
            width = contentRect.width;
            height = contentRect.height;
        }
        if (this._options.round) {
            width = Math.round(width);
            height = Math.round(height);
        }
        return { width, height };
    }
    _firstBoxSize(list) {
        if (!list || list.length === 0)
            return null;
        const first = list[0];
        return { inlineSize: first.inlineSize, blockSize: first.blockSize };
    }
    _normalizeRect(rect) {
        return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
        };
    }
    _optionsEqual(a, b) {
        if ((a.box ?? "content-box") !== (b.box ?? "content-box"))
            return false;
        return (a.round ?? false) === (b.round ?? false);
    }
}

const BOX_VALUES = ["content-box", "border-box", "device-pixel-content-box"];
/**
 * `<wcs-resize>` — declarative ResizeObserver.
 *
 * The `target` attribute is the single knob that decides both *what* is observed
 * and how the element renders (it never injects a layout box unless asked):
 *
 * | `target`        | observes              | display     | use case             |
 * |-----------------|-----------------------|-------------|----------------------|
 * | omitted         | first element child   | `contents`  | size a wrapped child |
 * | `"#panel"` / sel| the matched element   | `none`      | size an existing node|
 * | `"self"`        | the element itself    | `block`     | container-width probe|
 *
 * `display:contents` means wrapping a child injects no box of its own (so a
 * `<wcs-resize><div></wcs-resize>` does not disturb a flex/grid parent); the
 * `target="self"` form takes a `display:block` box that, as a zero-height element,
 * stretches to the parent's available inline size — a container-width probe.
 *
 * Note: a `display:contents` / `display:none` element generates no box, so the
 * observed node must be the child / selector target (which do have boxes), never
 * the `<wcs-resize>` host itself except in the `self` form.
 */
class WcsResize extends HTMLElement {
    static hasConnectedCallbackPromise = false;
    // Only attributes that change *what or how* we observe trigger a re-observe.
    // `once` is intentionally excluded: it is evaluated at change fire time (in
    // `_onChange`), so toggling it takes effect without re-observing — and a
    // re-observe on its change would be a pure no-op (same target, same options).
    // `manual` is also excluded: it is a connect-time policy ("don't auto-observe on
    // connect"), not a live switch that should start/stop an active observation.
    // `box` and `round` ARE observed: changing them rebuilds the observer, and the
    // rebuild re-delivers the initial size — which is exactly how a `round` toggle
    // re-emits width/height with the new rounding.
    static observedAttributes = ["target", "box", "round"];
    static wcBindable = {
        ...ResizeCore.wcBindable,
        properties: [
            ...ResizeCore.wcBindable.properties,
            { name: "trigger", event: "wcs-resize:trigger-changed" },
        ],
        // Shell-level settable surface. Each input carries its mirrored `attribute`
        // hint; `trigger` has none — it is a momentary command-property, not a
        // declarative attribute. The observe / unobserve / disconnect commands are
        // inherited from the Core via the spread above.
        inputs: [
            { name: "target", attribute: "target" },
            { name: "box", attribute: "box" },
            { name: "round", attribute: "round" },
            { name: "once", attribute: "once" },
            { name: "manual", attribute: "manual" },
            { name: "trigger" },
        ],
        // Core の commands をそのまま継承（単一情報源）。<wcs-intersect>/<wcs-sse> と同型。
        // spread でも継承されるが、Core に command 追加時の追従漏れを防ぐため明示参照する。
        commands: ResizeCore.wcBindable.commands,
    };
    _core;
    _trigger = false;
    constructor() {
        super();
        this._core = new ResizeCore(this);
    }
    // --- Attribute accessors ---
    get target() {
        return this.getAttribute("target") ?? "";
    }
    set target(value) {
        this.setAttribute("target", value);
    }
    get box() {
        return this.getAttribute("box") ?? "";
    }
    set box(value) {
        this.setAttribute("box", value);
    }
    get round() {
        return this.hasAttribute("round");
    }
    set round(value) {
        if (value) {
            this.setAttribute("round", "");
        }
        else {
            this.removeAttribute("round");
        }
    }
    get once() {
        return this.hasAttribute("once");
    }
    set once(value) {
        if (value) {
            this.setAttribute("once", "");
        }
        else {
            this.removeAttribute("once");
        }
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
    get entry() {
        return this._core.entry;
    }
    get width() {
        return this._core.width;
    }
    get height() {
        return this._core.height;
    }
    get observing() {
        return this._core.observing;
    }
    // --- Command property ---
    get trigger() {
        return this._trigger;
    }
    set trigger(value) {
        // Momentary command-property: a false→true write re-runs observe(). Mirrors the
        // trigger flag on <wcs-intersect> / <wcs-geo>. Prefer the command-token protocol
        // (`command.observe: $command.start`) for state-driven observation; this exists
        // mainly for simple boolean bindings.
        const v = !!value; // normalize truthy state-bindings, like <wcs-intersect>'s setter
        if (v) {
            this._trigger = true;
            // try/finally mirrors <wcs-intersect>'s set trigger: observe() is never-throw
            // today, but should a synchronous throw path ever appear, the finally still
            // auto-resets _trigger (no stuck-true latch) and emits the completion notice.
            try {
                this.observe();
            }
            finally {
                this._trigger = false;
                // Always auto-reset to false after the observe() attempt — this is the
                // *momentary acknowledgement* that the trigger was consumed, NOT a signal
                // that observation succeeded (whether the target resolved is reflected by
                // `observing`, not by this event). Read `observing` if you need the outcome.
                this.dispatchEvent(new CustomEvent("wcs-resize:trigger-changed", {
                    detail: false,
                    bubbles: true,
                }));
            }
        }
    }
    // --- Commands ---
    /** Re-resolve the target from the DOM and (re)start observing. */
    observe() {
        const { element, display } = this._resolveTarget();
        // `display` is derived from the `target` *mode* (self/selector/child), not from
        // whether the selector currently matches — so it is applied unconditionally,
        // before the resolution check. A `target="#x"` whose node is momentarily absent
        // still renders `display:none` (it is a selector pointer, never a box).
        this.style.display = display;
        if (!element) {
            // The target is no longer resolvable (e.g. a `target` selector whose node was
            // removed from the DOM). Tear down any stale observation so `observing` does
            // not keep reporting true against a node that is gone.
            this._core.disconnect();
            return;
        }
        this._core.observe(element, this._options());
    }
    unobserve() {
        // Single-target Shell: "stop observing my target" is exactly the Core's
        // teardown. Delegate to the Core's tracked state rather than re-resolving the
        // selector, so a target that has since left the DOM can still be stopped
        // (re-resolving would yield null and silently leave the observer running).
        this._core.disconnect();
    }
    disconnect() {
        this._core.disconnect();
    }
    // --- Internal ---
    _resolveTarget() {
        const target = this.target;
        if (target === "self") {
            // Explicit sentinel: observe the element itself. As a display:block zero-height
            // box it stretches to the parent's available inline size — a container probe.
            return { element: this, display: "block" };
        }
        if (target !== "") {
            // Selector pointer: observe a referenced element in place, staying invisible.
            const scope = this.getRootNode();
            // A user-authored selector can be syntactically invalid (e.g. `#`, `:::`,
            // `[data-*`), which makes querySelector throw a SyntaxError. Swallow it and
            // treat the target as unresolvable — the same "nothing to observe" path as a
            // selector matching no element — so a bad attribute never lets the throw escape
            // observe() → connectedCallback / attributeChangedCallback (never-throw).
            return { element: this._safeQuery(scope, target), display: "none" };
        }
        // Omitted: observe the first element child without injecting a box of our own.
        const child = this.firstElementChild;
        if (child) {
            return { element: child, display: "contents" };
        }
        // No child to wrap (e.g. used as an empty marker) — fall back to self.
        return { element: this, display: "block" };
    }
    // Wrap querySelector so a syntactically invalid user-authored selector resolves to
    // null (unresolvable) instead of letting the SyntaxError escape — keeping the
    // sensor never-throw, mirroring intersection's _safeQuery guard.
    _safeQuery(scope, selector) {
        try {
            return scope.querySelector(selector);
        }
        catch {
            return null;
        }
    }
    _parseBox() {
        const raw = this.box.trim();
        // Decision: an unrecognized box value falls back to content-box at parse time
        // (rather than letting the Core's observe() reject it), mirroring threshold's
        // range filter in <wcs-intersect>. The Core still has its own runtime fallback
        // for a *valid-but-unsupported* box (e.g. device-pixel-content-box on Safari).
        return BOX_VALUES.includes(raw) ? raw : "content-box";
    }
    _options() {
        return {
            box: this._parseBox(),
            round: this.round,
        };
    }
    _onChange = (event) => {
        // `wcs-resize:change` bubbles, so a nested `<wcs-resize>` descendant's change
        // would otherwise reach this (ancestor) listener and let a *child's* resize tear
        // down *our* observer. Only act on our own Core's event. (This also avoids
        // reading `.detail` off a foreign event shape.)
        if (event.target !== this)
            return;
        // `once`: tear down after the first size observation. ResizeObserver always
        // delivers the initial size on observe(), so once = measure-once. Gated at fire
        // time so toggling the `once` attribute takes effect live.
        if (this.once) {
            this._core.disconnect();
        }
    };
    // --- Lifecycle ---
    connectedCallback() {
        this.addEventListener("wcs-resize:change", this._onChange);
        if (!this.manual) {
            this.observe();
        }
    }
    disconnectedCallback() {
        this.removeEventListener("wcs-resize:change", this._onChange);
        this._core.disconnect();
    }
    attributeChangedCallback(_name, oldValue, newValue) {
        // Defensive same-value guard. Per the HTML spec, an attribute change reaction is
        // enqueued whenever setAttribute() runs — including with an unchanged value — so
        // attributeChangedCallback CAN fire on a same-value write. Re-observing on an
        // unchanged attribute would be a wasted observer rebuild, so bail early when the
        // value did not actually change. Kept intentionally; do not remove.
        if (oldValue === newValue)
            return;
        // Only react once connected and in automatic mode. The Core's idempotency guard
        // absorbs the autoloader upgrade case (attributeChangedCallback +
        // connectedCallback both calling observe() with identical options).
        if (!this.isConnected || this.manual)
            return;
        this.observe();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.resize)) {
        customElements.define(config.tagNames.resize, WcsResize);
    }
}

function bootstrapResize(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { ResizeCore, WcsResize, bootstrapResize, getConfig };
//# sourceMappingURL=index.esm.js.map

const _config = {
    tagNames: {
        intersect: "wcs-intersect",
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
 * Headless visibility primitive. A thin, framework-agnostic wrapper around the
 * IntersectionObserver API exposed through the wc-bindable protocol.
 *
 * Unlike the other @wcstack sensors (geolocation / timer / websocket), the thing
 * being observed is a *DOM element* — so `observe()` takes the target node. The
 * Core stays DOM-resolution-agnostic: it observes whatever element it is handed
 * (the Shell resolves `target` / `root` selectors before calling). It is a
 * read-only producer — element/layout → state only, with no element-bound path.
 *
 * Every observer callback is published via the single `wcs-intersect:change`
 * event; `intersecting` / `ratio` are read from it through getters (mirroring how
 * GeolocationCore exposes latitude/longitude from one `wcs-geo:position` event),
 * so an observer that binds any of them is notified on every change.
 *
 * `visible` is a latch: it flips to `true` the first time the target intersects
 * and stays `true` until `reset()` — ideal for one-way lazy-load bindings
 * (`src@visible`). `observing` reflects whether an observation is currently
 * active (like TimerCore's `running`).
 *
 * Single-target by design: the Shell observes exactly one element, so the state
 * reflects that element. Multi-target observation is intentionally out of scope.
 */
class IntersectionCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "entry", event: "wcs-intersect:change" },
            { name: "intersecting", event: "wcs-intersect:change", getter: (e) => e.detail.isIntersecting },
            { name: "ratio", event: "wcs-intersect:change", getter: (e) => e.detail.intersectionRatio },
            { name: "visible", event: "wcs-intersect:visible-changed" },
            { name: "observing", event: "wcs-intersect:observing-changed" },
        ],
        commands: [
            { name: "observe" },
            { name: "reobserve" },
            { name: "unobserve" },
            { name: "disconnect" },
            { name: "reset" },
        ],
    };
    _target;
    // The live observer and the single element it observes. Options are kept so a
    // repeated observe() with identical options is a no-op (avoids the create→
    // observe→disconnect churn an autoloader upgrade can otherwise cause).
    _observer = null;
    _observed = null;
    _options = {};
    _entry = null;
    _visible = false;
    _observing = false;
    // Generation guard (§3.4): bumped on dispose() and on each observe()/reobserve()
    // teardown+rebuild. IntersectionObserver delivers its callback asynchronously off
    // layout, so a callback can fire after the element is disposed or after a rapid
    // disconnect→reconnect rebuilt the observer. Each observer captures the gen live at
    // creation; a callback from a superseded/torn-down observer has a stale gen and
    // MUST NOT write state to a torn-down element. A boolean flag is insufficient
    // (dispose→observe would flip it back and let stale work slip through).
    _gen = 0;
    // SSR (§3.8): IntersectionObserver setup is synchronous (no async probe to await),
    // so readiness is immediate.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    /** Resolves immediately — there is no asynchronous probe to await (§3.8). */
    get ready() {
        return this._ready;
    }
    get entry() {
        return this._entry;
    }
    get intersecting() {
        return this._entry ? this._entry.isIntersecting : false;
    }
    get ratio() {
        return this._entry ? this._entry.intersectionRatio : 0;
    }
    get visible() {
        return this._visible;
    }
    get observing() {
        return this._observing;
    }
    // --- State setters with event dispatch ---
    _setEntry(entry) {
        // No same-value guard: `change` carries event semantics (every callback is a
        // distinct observation) and `intersecting` / `ratio` are derived getters that
        // must re-fire on each entry, mirroring GeolocationCore's `position`.
        this._entry = entry;
        this._target.dispatchEvent(new CustomEvent("wcs-intersect:change", {
            detail: entry,
            bubbles: true,
        }));
    }
    _setVisible(visible) {
        if (this._visible === visible)
            return;
        this._visible = visible;
        this._target.dispatchEvent(new CustomEvent("wcs-intersect:visible-changed", {
            detail: visible,
            bubbles: true,
        }));
    }
    _setObserving(observing) {
        if (this._observing === observing)
            return;
        this._observing = observing;
        this._target.dispatchEvent(new CustomEvent("wcs-intersect:observing-changed", {
            detail: observing,
            bubbles: true,
        }));
    }
    // --- Public API ---
    /**
     * Start observing `element`. Idempotent while already observing the same
     * element with the same options. Changing the element or options tears down the
     * current observer and builds a new one (IntersectionObserver options are fixed
     * at construction, so reconfiguring requires a fresh observer).
     *
     * If IntersectionObserver is unavailable (SSR) or the options are invalid (e.g.
     * a malformed `rootMargin`, which the constructor rejects), this is a silent
     * no-op — `observing` stays false, consistent with the never-throw design of
     * the other @wcstack sensors.
     */
    observe(element, options = {}) {
        if (this._observer && this._observed === element && this._optionsEqual(this._options, options)) {
            return this._ready;
        }
        this._teardownObserver();
        const observer = this._createObserver(options);
        if (!observer) {
            // Creation failed (unsupported environment or invalid options) *after* we
            // tore down any previous observer. If we were already observing, the
            // observation is now gone, so reflect that — otherwise `observing` would
            // keep reporting true with no live observer behind it (e.g. re-observing an
            // active target with a newly-invalid rootMargin).
            this._setObserving(false);
            return this._ready;
        }
        this._observer = observer;
        this._observed = element;
        this._options = options;
        observer.observe(element);
        this._setObserving(true);
        // SSR (§3.5): observe() returns the readiness promise. Observation establishment
        // is synchronous, so this resolves immediately.
        return this._ready;
    }
    /**
     * Force a fresh observation of `element`, even when it matches the currently
     * observed target+options. Unlike observe() — which is idempotent and
     * early-returns for an unchanged target+options *without* re-delivering a
     * callback — this always tears the observer down and rebuilds it, so a new
     * IntersectionObserver delivers an initial callback for the element's CURRENT
     * visibility.
     *
     * This is the way to re-arm an edge-driven consumer (e.g. infinite scroll) after
     * the layout changed without a visibility *transition*: IntersectionObserver only
     * fires on a change, so appending a short page that leaves the sentinel visible
     * yields no new callback — a bare observe() can't help (idempotent), but a
     * reobserve() re-reads the current state. Same never-throw guarantees as
     * observe(); `observing` stays true across a successful re-arm (no false blip).
     */
    reobserve(element, options = {}) {
        this._teardownObserver();
        this.observe(element, options);
    }
    /**
     * Stop observing `element`. A no-op if it is not the currently observed
     * element. The observer instance is torn down (single-target Core), so a later
     * observe() rebuilds it.
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
    /** Clear the `visible` latch so a later intersection can set it again. */
    reset() {
        this._setVisible(false);
    }
    // --- Lifecycle (§3.5) ---
    /**
     * `observe()` (the IntersectionObserver-style command above) establishes
     * monitoring, so there is no separate idempotent monitoring entry point — only
     * teardown. `dispose()` invalidates any in-flight observer callback (`_gen++`)
     * and releases the observer. A later observe() revives it (the Shell calls this
     * from `disconnectedCallback`).
     */
    dispose() {
        this._gen++;
        this.disconnect();
    }
    // --- Internal ---
    _teardownObserver() {
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
        this._observed = null;
        // Invalidate the torn-down observer's generation: its callback can still fire
        // once asynchronously after disconnect(), and must be dropped (§3.4).
        this._gen++;
    }
    _createObserver(options) {
        if (typeof IntersectionObserver === "undefined")
            return null;
        // Capture the generation live at creation. The callback closure below guards
        // against deliveries from this observer after it has been superseded or
        // disposed (a stale callback fired off layout after teardown).
        const gen = this._gen;
        try {
            return new IntersectionObserver((entries) => this._onIntersect(gen, entries), {
                root: options.root ?? null,
                rootMargin: options.rootMargin ?? "0px",
                threshold: options.threshold ?? 0,
            });
        }
        catch {
            // Invalid options (e.g. a malformed rootMargin) — surface nothing and leave
            // observing false, rather than letting the constructor throw escape.
            return null;
        }
    }
    _onIntersect(gen, entries) {
        // Stale-generation guard (§3.4): drop callbacks from an observer that was torn
        // down or disposed (e.g. a delivery that landed after disconnect/reconnect).
        if (gen !== this._gen)
            return;
        for (const entry of entries) {
            const normalized = this._normalizeEntry(entry);
            this._setEntry(normalized);
            // Latch on the first (and any) intersecting observation; never auto-clears.
            if (normalized.isIntersecting) {
                this._setVisible(true);
            }
        }
    }
    _normalizeEntry(entry) {
        return {
            isIntersecting: entry.isIntersecting,
            intersectionRatio: entry.intersectionRatio,
            time: entry.time,
            boundingClientRect: this._normalizeRect(entry.boundingClientRect),
            intersectionRect: this._normalizeRect(entry.intersectionRect),
            rootBounds: entry.rootBounds ? this._normalizeRect(entry.rootBounds) : null,
            target: entry.target,
        };
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
        if ((a.root ?? null) !== (b.root ?? null))
            return false;
        if ((a.rootMargin ?? "0px") !== (b.rootMargin ?? "0px"))
            return false;
        return this._thresholdKey(a.threshold) === this._thresholdKey(b.threshold);
    }
    _thresholdKey(threshold) {
        if (threshold === undefined)
            return "0";
        return Array.isArray(threshold) ? threshold.join(",") : String(threshold);
    }
}

/**
 * `<wcs-intersect>` — declarative IntersectionObserver.
 *
 * The `target` attribute is the single knob that decides both *what* is observed
 * and how the element renders (it never injects a layout box unless asked):
 *
 * | `target`        | observes              | display     | use case          |
 * |-----------------|-----------------------|-------------|-------------------|
 * | omitted         | first element child   | `contents`  | lazy-load wrapper |
 * | `"#hero"` / sel | the matched element   | `none`      | scrollspy (single)|
 * | `"self"`        | the element itself    | `block`     | infinite-scroll   |
 *
 * `display:contents` means wrapping a child injects no box of its own (so a
 * `<wcs-intersect><img></wcs-intersect>` does not disturb a flex/grid parent);
 * only the explicit `target="self"` sentinel takes a box.
 */
class WcsIntersect extends HTMLElement {
    // SSR (§4.4): the first observation is established synchronously on connect, but
    // the Shell still exposes connectedCallbackPromise so the state binder can await
    // it uniformly across all IO nodes before snapshotting.
    static hasConnectedCallbackPromise = true;
    // Only attributes that change *what or how* we observe trigger a re-observe.
    // `once` is intentionally excluded: it is evaluated at intersection fire time
    // (in `_onChange`), so toggling it takes effect without re-observing — and a
    // re-observe on its change would be a pure no-op (same target, same options).
    // `manual` is also excluded: it is a connect-time policy ("don't auto-observe
    // on connect"), not a live switch that should start/stop an active observation.
    static observedAttributes = ["target", "root", "root-margin", "threshold"];
    static wcBindable = {
        ...IntersectionCore.wcBindable,
        properties: [
            ...IntersectionCore.wcBindable.properties,
            { name: "trigger", event: "wcs-intersect:trigger-changed" },
        ],
        // Shell-level settable surface. Each input carries its mirrored `attribute`
        // hint; `trigger` has none — it is a momentary command-property, not a
        // declarative attribute. The observe / reobserve / unobserve / disconnect /
        // reset commands are inherited from the Core via the spread above.
        inputs: [
            { name: "target", attribute: "target" },
            { name: "root", attribute: "root" },
            { name: "rootMargin", attribute: "root-margin" },
            { name: "threshold", attribute: "threshold" },
            { name: "once", attribute: "once" },
            { name: "manual", attribute: "manual" },
            { name: "trigger" },
        ],
        // Core の commands をそのまま継承（単一情報源）。<wcs-sse>/<wcs-broadcast> と同型。
        // spread でも継承されるが、Core に command 追加時の追従漏れを防ぐため明示参照する。
        commands: IntersectionCore.wcBindable.commands,
    };
    _core;
    _trigger = false;
    _connectedCallbackPromise = Promise.resolve();
    constructor() {
        super();
        this._core = new IntersectionCore(this);
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
    get root() {
        return this.getAttribute("root") ?? "";
    }
    set root(value) {
        this.setAttribute("root", value);
    }
    get rootMargin() {
        const attr = this.getAttribute("root-margin");
        return attr === null || attr.trim() === "" ? "0px" : attr;
    }
    set rootMargin(value) {
        this.setAttribute("root-margin", value);
    }
    get threshold() {
        return this.getAttribute("threshold") ?? "";
    }
    set threshold(value) {
        this.setAttribute("threshold", value);
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
    get intersecting() {
        return this._core.intersecting;
    }
    get ratio() {
        return this._core.ratio;
    }
    get visible() {
        return this._core.visible;
    }
    get observing() {
        return this._core.observing;
    }
    // --- Command property ---
    get trigger() {
        return this._trigger;
    }
    set trigger(value) {
        // Momentary command-property: a false→true write re-runs observe(). Mirrors
        // the trigger flag on <wcs-geo> / <wcs-ws> / <wcs-sse>. Prefer the command-token
        // protocol (`command.observe: $command.start`) for state-driven observation;
        // this exists mainly for simple boolean bindings.
        const v = !!value; // normalize truthy state-bindings, like <wcs-sse>'s setter
        if (v) {
            this._trigger = true;
            // try/finally mirrors <wcs-sse>'s set trigger: observe() is never-throw
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
                // `observing`, not by this event). Firing unconditionally keeps the bound
                // state's trigger flag from sticking at true regardless of resolution.
                // Read `observing` if you need the actual outcome.
                this.dispatchEvent(new CustomEvent("wcs-intersect:trigger-changed", {
                    detail: false,
                    bubbles: true,
                }));
            }
        }
    }
    // --- Commands ---
    /** Re-resolve the target/root from the DOM and (re)start observing. */
    observe() {
        const { element, display } = this._resolveTarget();
        // `display` is derived from the `target` *mode* (self/selector/child), not from
        // whether the selector currently matches — so it is applied unconditionally,
        // before the resolution check. A `target="#x"` whose node is momentarily absent
        // still renders `display:none` (it is a selector pointer, never a box).
        this.style.display = display;
        if (!element) {
            // The target is no longer resolvable (e.g. a `target` selector whose node
            // was removed from the DOM). Tear down any stale observation so `observing`
            // does not keep reporting true against a node that is gone.
            this._core.disconnect();
            return;
        }
        this._core.observe(element, this._options());
    }
    /**
     * Force a fresh observation: re-resolve target/root from the DOM and re-observe
     * even when nothing changed. Unlike observe() (idempotent for an unchanged
     * target+options), this rebuilds the observer so a new initial callback fires for
     * the current visibility — the way to re-arm an edge-driven consumer after the
     * layout shifted without a visibility transition (e.g. infinite scroll appended a
     * short page that left this sentinel in view). Resolution/teardown rules match
     * observe(): an unresolvable target tears down any stale observation.
     */
    reobserve() {
        const { element, display } = this._resolveTarget();
        this.style.display = display;
        if (!element) {
            this._core.disconnect();
            return;
        }
        this._core.reobserve(element, this._options());
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
    reset() {
        this._core.reset();
    }
    // --- Internal ---
    _resolveTarget() {
        const target = this.target;
        if (target === "self") {
            // Explicit sentinel: observe the element itself as a (typically zero-height)
            // marker, which requires a layout box.
            return { element: this, display: "block" };
        }
        if (target !== "") {
            // Selector pointer: observe a referenced element in place, staying invisible.
            const scope = this.getRootNode();
            // A user-authored selector can be syntactically invalid (e.g. `#`, `:::`,
            // `[data-*`), which makes querySelector throw a SyntaxError. Swallow it and
            // treat the target as unresolvable — the same "nothing to observe" path as a
            // selector matching no element — so a bad attribute never lets the throw
            // escape observe() → connectedCallback / attributeChangedCallback (never-throw).
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
    _resolveRoot() {
        const root = this.root;
        if (root === "")
            return null;
        const scope = this.getRootNode();
        // Same never-throw guard as the target selector: an invalid `root` selector
        // falls back to a null root (the viewport) rather than throwing out of observe().
        return this._safeQuery(scope, root);
    }
    // Wrap querySelector so a syntactically invalid user-authored selector resolves
    // to null (unresolvable) instead of letting the SyntaxError escape — keeping the
    // sensor never-throw, mirroring worker/src/autoTrigger.ts's resolveText guard.
    _safeQuery(scope, selector) {
        try {
            return scope.querySelector(selector);
        }
        catch {
            return null;
        }
    }
    _parseThreshold() {
        const raw = this.threshold.trim();
        if (raw === "")
            return 0;
        // Strict parse via Number() (unlike parseFloat, "0.5px" -> NaN, not 0.5); drop
        // any non-finite or out-of-range [0,1] value, matching the README note.
        // Drop empty slots first ("0,,1" / "1,") — Number("") is 0, which would
        // otherwise smuggle a spurious 0 threshold past the finite/range filter.
        const nums = raw
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s !== "")
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n) && n >= 0 && n <= 1);
        if (nums.length === 0)
            return 0;
        return nums.length === 1 ? nums[0] : nums;
    }
    _options() {
        return {
            root: this._resolveRoot(),
            rootMargin: this.rootMargin,
            threshold: this._parseThreshold(),
        };
    }
    _onChange = (event) => {
        // `wcs-intersect:change` bubbles, so a nested `<wcs-intersect>` descendant's
        // change would otherwise reach this (ancestor) listener and let a *child's*
        // intersection tear down *our* observer. Only act on our own Core's event.
        // (This also avoids reading `.detail` off a foreign event shape.)
        if (event.target !== this)
            return;
        // `once`: tear down after the first intersecting observation (lazy-load idiom).
        // Gated at fire time so toggling the `once` attribute takes effect live.
        if (this.once && event.detail.isIntersecting) {
            this._core.disconnect();
        }
    };
    // --- Lifecycle ---
    connectedCallback() {
        this.addEventListener("wcs-intersect:change", this._onChange);
        if (!this.manual) {
            this.observe();
        }
        // SSR (§4.4): readiness is synchronous (observation is established above), but
        // expose the Core's ready promise as connectedCallbackPromise so the state
        // binder can await it uniformly. `manual` defers observation but readiness is
        // still immediate.
        this._connectedCallbackPromise = this._core.ready;
    }
    disconnectedCallback() {
        this.removeEventListener("wcs-intersect:change", this._onChange);
        // dispose() tears down the observer AND bumps the Core's generation so any
        // IntersectionObserver callback still in flight is dropped (§3.4 / §4.1).
        this._core.dispose();
    }
    attributeChangedCallback(_name, oldValue, newValue) {
        // Defensive same-value guard. Per spec attributeChangedCallback only fires on
        // an actual value change, so this is effectively a dead branch today — but
        // setAttribute() with an unchanged value (and some test/tooling paths) can
        // still invoke it, and re-observing on an unchanged attribute would be a
        // wasted observer rebuild. Kept intentionally; do not remove.
        if (oldValue === newValue)
            return;
        // Only react once connected and in automatic mode. The Core's idempotency
        // guard absorbs the autoloader upgrade case (attributeChangedCallback +
        // connectedCallback both calling observe() with identical options).
        if (!this.isConnected || this.manual)
            return;
        this.observe();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.intersect)) {
        customElements.define(config.tagNames.intersect, WcsIntersect);
    }
}

function bootstrapIntersection(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { IntersectionCore, WcsIntersect, bootstrapIntersection, getConfig };
//# sourceMappingURL=index.esm.js.map

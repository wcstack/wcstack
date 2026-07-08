const _config = {
    autoTrigger: true,
    triggerAttribute: "data-debouncetarget",
    tagNames: {
        debounce: "wcs-debounce",
        throttle: "wcs-throttle",
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
 * Build the wc-bindable `properties` list for a debounce/throttle element, with
 * every event name derived from a single `prefix`. `<wcs-debounce>` uses
 * `"wcs-debounce"`, `<wcs-throttle>` uses `"wcs-throttle"`, so the two tags share
 * one engine (DebounceCore) yet advertise distinct event namespaces from one
 * source of truth — no hand-duplicated property tables (cf. the geolocation Shell
 * which overrode its wcBindable by hand).
 *
 * - `value`   — the debounced value of the latest `source` write (value surface),
 *               read from the `<prefix>:settled` event.
 * - `fired`   — the coalesced args of the latest `trigger()` pulse (signal
 *               surface), read from the `<prefix>:fired` event. Declared as a
 *               property (not just an event) so state can subscribe via the
 *               event-token protocol (`eventToken.fired: <name>`).
 * - `pending` — whether a debounce is currently in flight.
 */
function makeDebounceProperties(prefix) {
    return [
        { name: "value", event: `${prefix}:settled`, getter: (e) => e.detail.value },
        { name: "fired", event: `${prefix}:fired`, getter: (e) => e.detail.args },
        { name: "pending", event: `${prefix}:pending-changed` },
    ];
}

/**
 * Headless debounce/throttle primitive. A framework-agnostic port of lodash's
 * `debounce` algorithm (`shouldInvoke` / `leadingEdge` / `trailingEdge` /
 * `remainingWait`, timed via `Date.now()`), exposed through the wc-bindable
 * protocol.
 *
 * It coalesces a stream of *signals* and emits at most one per quiet period.
 * Two surfaces share the single timer:
 *
 * - **value** — writing {@link setSource} schedules a settle; on fire the
 *   debounced value is published via the `<prefix>:settled` event and the
 *   `value` getter. Wire it as `source: src; value: debounced`.
 * - **signal** — calling {@link trigger}`(...args)` coalesces a burst of pulses;
 *   on fire one `<prefix>:fired` event carries the latest args (relayed by state
 *   through the command-token / event-token protocols).
 *
 * A given instance is meant to be used for one surface at a time. Because each
 * surface keeps its own field (`_value` vs `_lastArgs`), the getters never
 * pollute each other; if both are driven on one instance the *last* scheduled
 * signal wins (lodash's last-args semantics).
 *
 * Throttle is the same engine with `maxWait === wait` (and `leading` on by
 * default), so `<wcs-throttle>` reuses this class with a different `eventPrefix`.
 */
class DebounceCore extends EventTarget {
    // The static contract advertises the *default* `wcs-debounce:*` event names. A
    // headless Core constructed with a non-default `eventPrefix` (e.g.
    // `"wcs-throttle"`) dispatches under that prefix, so its events won't match
    // this metadata — rebuild the property table with `makeDebounceProperties(prefix)`
    // for that case. (The `<wcs-throttle>` Shell already overrides its own
    // `wcBindable` this way, so binding through an element is always consistent.)
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: makeDebounceProperties("wcs-debounce"),
        commands: [
            { name: "trigger" },
            { name: "cancel" },
            { name: "flush" },
        ],
    };
    _prefix;
    _target;
    // Tuning (lodash knobs).
    _wait = 0;
    _leading = false;
    _trailing = true;
    _maxWait = 0;
    _hasMaxWait = false;
    // Timing bookkeeping.
    _lastCallTime = undefined;
    _lastInvokeTime = 0;
    _timerId = null;
    // Generation stamped onto the live timer at arm time, compared in
    // `_timerExpired` against `_gen` to drop callbacks that outlived a dispose().
    _timerGen = 0;
    // Last-wins pending payload. `_pendingKind === null` doubles as the "consumed /
    // empty" sentinel (lodash clears `lastArgs` in invokeFunc): a trailing edge with
    // no fresh call since the last fire sees `null` and does not re-fire, which is
    // what stops a single leading pulse from also firing on the trailing edge.
    _pendingKind = null;
    _pendingValue = undefined;
    _pendingArgs = undefined;
    // Observable state (getter backing).
    _value = undefined;
    _lastArgs = [];
    _pending = false;
    // Generation guard (§3.4): bumped on dispose() so a timer that survives a
    // tear-down can no longer settle into a detached element. A pending timer is
    // also cleared by dispose() → cancel(), so the guard is defensive: it stops
    // any callback that has already been dequeued by the host event loop from
    // writing state after dispose().
    _gen = 0;
    // SSR (§3.8): the debounce engine is purely timer-driven with no asynchronous
    // probe to await, so readiness is immediate.
    _ready = Promise.resolve();
    constructor(prefix = "wcs-debounce", target, options) {
        super();
        this._prefix = prefix;
        this._target = target ?? this;
        if (options) {
            this.configure(options);
        }
    }
    // --- Lifecycle (§3.5 / §3.8) ---
    get ready() {
        return this._ready;
    }
    // Debounce is command-driven (setSource / trigger schedule work on demand)
    // with no subscription to establish, so observe() is an idempotent no-op that
    // resolves once ready.
    observe() {
        return this._ready;
    }
    // Tear down the pending timer and invalidate the generation so a stale timer
    // callback cannot fire after the element is detached.
    dispose() {
        this._gen++;
        this.cancel();
    }
    // --- Configuration ---
    /**
     * Update the tuning knobs. The Shell calls this with the element's current
     * attributes before each schedule, so live attribute edits take effect on the
     * next signal. `maxWait` is clamped to at least `wait` (lodash semantics); an
     * absent / invalid `maxWait` disables maxWait entirely.
     */
    configure(options = {}) {
        if (typeof options.wait === "number" && Number.isFinite(options.wait) && options.wait >= 0) {
            this._wait = options.wait;
        }
        if (typeof options.leading === "boolean") {
            this._leading = options.leading;
        }
        if (typeof options.trailing === "boolean") {
            this._trailing = options.trailing;
        }
        const mw = options.maxWait;
        if (typeof mw === "number" && Number.isFinite(mw) && mw >= 0) {
            this._maxWait = Math.max(mw, this._wait);
            this._hasMaxWait = true;
        }
        else {
            this._maxWait = 0;
            this._hasMaxWait = false;
        }
    }
    // --- Observable getters ---
    get value() {
        return this._value;
    }
    get fired() {
        return this._lastArgs;
    }
    get pending() {
        return this._pending;
    }
    // --- Public entry points ---
    /** Value surface: schedule a settle carrying `value` (last write wins). */
    setSource(value) {
        this._schedule("value", value, undefined);
    }
    /** Signal surface: coalesce a pulse carrying `args` (last call wins). */
    trigger(...args) {
        this._schedule("signal", undefined, args);
    }
    /** Drop any pending fire without emitting. Getters keep their last values. */
    cancel() {
        this._clearTimer();
        this._lastInvokeTime = 0;
        this._lastCallTime = undefined;
        this._pendingKind = null;
        this._pendingValue = undefined;
        this._pendingArgs = undefined;
        this._setPending(false);
    }
    /**
     * Emit any buffered payload immediately, then clear pending. Unlike lodash's
     * `flush` (which honours `trailing`), this fires whatever is buffered — the
     * command's intent is "publish now" — but is a no-op when nothing is pending.
     */
    flush() {
        if (this._timerId === null && this._pendingKind === null)
            return;
        const now = Date.now();
        this._clearTimer();
        if (this._pendingKind !== null) {
            this._invoke(now);
        }
        this._pendingKind = null;
        this._pendingValue = undefined;
        this._pendingArgs = undefined;
        this._setPending(false);
    }
    // --- Engine (lodash port) ---
    _schedule(kind, value, args) {
        const now = Date.now();
        const isInvoking = this._shouldInvoke(now);
        this._pendingKind = kind;
        if (kind === "value") {
            this._pendingValue = value;
        }
        else {
            this._pendingArgs = args;
        }
        this._lastCallTime = now;
        this._setPending(true);
        if (isInvoking) {
            if (this._timerId === null) {
                this._leadingEdge(now);
                return;
            }
            if (this._hasMaxWait) {
                // Continuous input that has reached maxWait: restart the steady timer and
                // invoke now so a fire happens at least every maxWait ms (throttle path).
                // Clear the pending handle first (lodash's "tight loop" branch does the
                // same) — overwriting `_timerId` without clearing would orphan the old
                // timer and let it fire spuriously later.
                this._clearTimer();
                this._armTimer(this._wait);
                this._invoke(now);
                return;
            }
        }
        if (this._timerId === null) {
            this._armTimer(this._wait);
        }
    }
    _shouldInvoke(now) {
        if (this._lastCallTime === undefined)
            return true;
        const timeSinceLastCall = now - this._lastCallTime;
        const timeSinceLastInvoke = now - this._lastInvokeTime;
        return (timeSinceLastCall >= this._wait ||
            timeSinceLastCall < 0 ||
            (this._hasMaxWait && timeSinceLastInvoke >= this._maxWait));
    }
    _remainingWait(now) {
        const timeSinceLastCall = now - this._lastCallTime;
        const timeSinceLastInvoke = now - this._lastInvokeTime;
        const timeWaiting = this._wait - timeSinceLastCall;
        return this._hasMaxWait
            ? Math.min(timeWaiting, this._maxWait - timeSinceLastInvoke)
            : timeWaiting;
    }
    _timerExpired = () => {
        // §3.4 generation guard: a timer dequeued by the host before dispose() could
        // clear it must not settle into a torn-down element. Capture the generation
        // when the timer is scheduled (via `_armTimer`) and bail if it is stale.
        if (this._timerGen !== this._gen)
            return;
        const now = Date.now();
        if (this._shouldInvoke(now)) {
            this._trailingEdge(now);
            return;
        }
        // Fired before the quiet period elapsed (a later call moved the deadline) —
        // re-arm for the remaining time instead of settling now.
        this._armTimer(this._remainingWait(now));
    };
    _leadingEdge(now) {
        this._lastInvokeTime = now;
        this._armTimer(this._wait);
        if (this._leading) {
            this._invoke(now);
        }
    }
    _trailingEdge(now) {
        this._timerId = null;
        // Only fire when there is an unconsumed payload (a call arrived since the last
        // invoke). After a lone leading fire `_pendingKind` is null, so a single pulse
        // does not double-fire on its trailing edge.
        if (this._trailing && this._pendingKind !== null) {
            this._invoke(now);
        }
        this._pendingKind = null;
        this._pendingValue = undefined;
        this._pendingArgs = undefined;
        this._setPending(false);
    }
    _invoke(now) {
        this._lastInvokeTime = now;
        const kind = this._pendingKind;
        if (kind === "value") {
            this._value = this._pendingValue;
            this._dispatch(`${this._prefix}:settled`, { value: this._value });
        }
        else if (kind === "signal") {
            this._lastArgs = this._pendingArgs ?? [];
            this._dispatch(`${this._prefix}:fired`, { args: this._lastArgs });
        }
        // Mark consumed (mirrors lodash clearing `lastArgs`).
        this._pendingKind = null;
    }
    _setPending(pending) {
        if (this._pending === pending)
            return;
        this._pending = pending;
        this._dispatch(`${this._prefix}:pending-changed`, pending);
    }
    _dispatch(type, detail) {
        this._target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
    }
    // Arm the settle timer, stamping the current generation so a callback that the
    // host dequeues after a dispose() can detect it is stale (§3.4).
    _armTimer(delay) {
        this._timerGen = this._gen;
        this._timerId = setTimeout(this._timerExpired, delay);
    }
    _clearTimer() {
        if (this._timerId !== null) {
            clearTimeout(this._timerId);
            this._timerId = null;
        }
    }
}

let registered = false;
function handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element))
        return;
    const triggerElement = target.closest(`[${config.triggerAttribute}]`);
    if (!triggerElement)
        return;
    const id = triggerElement.getAttribute(config.triggerAttribute);
    if (!id)
        return;
    // Resolve the registered constructors at call time (avoids a components ⇄
    // autoTrigger import cycle, mirroring <wcs-timer>). The DOM trigger fires a
    // single coalesced pulse on the referenced <wcs-debounce> / <wcs-throttle>.
    const DebounceCtor = customElements.get(config.tagNames.debounce);
    const ThrottleCtor = customElements.get(config.tagNames.throttle);
    const el = document.getElementById(id);
    if (!el)
        return;
    const isDebounce = DebounceCtor && el instanceof DebounceCtor;
    const isThrottle = ThrottleCtor && el instanceof ThrottleCtor;
    if (!isDebounce && !isThrottle)
        return;
    // Suppress the element's default action so a debounce can fire without
    // navigating. See README "Optional DOM Triggering".
    event.preventDefault();
    el.trigger();
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

const DEFAULT_WAIT = 250;
/**
 * `<wcs-debounce>` — declarative debounce. See {@link DebounceCore} for the
 * engine. The `eventPrefix` defaults to `"wcs-debounce"`; `<wcs-throttle>`
 * subclasses this with `"wcs-throttle"` and throttle defaults.
 */
class Debounce extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static eventPrefix = "wcs-debounce";
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: makeDebounceProperties("wcs-debounce"),
        // `source` is the value-surface input (its debounced echo comes back on the
        // `value` property). `trigger` / `cancel` / `flush` are commands from the
        // Core. No momentary boolean `trigger` property exists — the signal surface
        // is driven by the `trigger` command (command-token) or a DOM click
        // (autoTrigger), which sidesteps the attribute/method name clash that forced
        // <wcs-geo>'s watch → watchPosition rename.
        inputs: [
            { name: "source" },
            { name: "wait", attribute: "wait" },
            // No `attribute` hint on leading / trailing: their setters already reflect
            // to the backing attribute themselves (the fetch-Shell idiom), and — more
            // importantly — the backing attribute is NOT the input name. `trailing`
            // reflects to the inverted `no-trailing` (default true; a bare `trailing`
            // attribute can't express false), and the `<wcs-throttle>` subclass reads
            // `leading` from the inverted `no-leading` (default on). A single
            // input-name→attribute hint can't be correct for both polarities/subclasses,
            // so binders drive these through the property setter instead.
            { name: "leading" },
            { name: "trailing" },
            { name: "maxWait", attribute: "max-wait" },
        ],
        commands: [
            { name: "trigger" },
            { name: "cancel" },
            { name: "flush" },
        ],
    };
    _core;
    _source = undefined;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new DebounceCore(this.constructor.eventPrefix, this);
        this._internals = this._initInternals();
        // `<wcs-throttle>` extends this class without overriding the constructor, so
        // `this.constructor` resolves to the actual subclass here too — the map key
        // tracks whichever `eventPrefix` the instance dispatches under
        // (docs/custom-state-reflection-design.md §3.4).
        const prefix = this.constructor.eventPrefix;
        this._wireStates({ [`${prefix}:pending-changed`]: (d) => ({ pending: d === true }) });
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
    get wait() {
        const attr = this.getAttribute("wait");
        if (attr === null || attr.trim() === "")
            return this._defaultWait();
        // Strict parse via Number() ("100px" -> NaN, not 100). Fall back to the
        // default for any non-finite or negative value.
        const parsed = Number(attr);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : this._defaultWait();
    }
    set wait(value) {
        this.setAttribute("wait", String(value));
    }
    get leading() {
        return this.hasAttribute("leading");
    }
    set leading(value) {
        if (value) {
            this.setAttribute("leading", "");
        }
        else {
            this.removeAttribute("leading");
        }
    }
    // `trailing` defaults to true; the boolean `no-trailing` attribute opts out (a
    // bare `trailing` attribute can't express "false", so the negative flag carries
    // the override).
    get trailing() {
        return !this.hasAttribute("no-trailing");
    }
    set trailing(value) {
        if (value) {
            this.removeAttribute("no-trailing");
        }
        else {
            this.setAttribute("no-trailing", "");
        }
    }
    get maxWait() {
        const attr = this.getAttribute("max-wait");
        if (attr === null || attr.trim() === "")
            return this._defaultMaxWait();
        const parsed = Number(attr);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : this._defaultMaxWait();
    }
    set maxWait(value) {
        this.setAttribute("max-wait", String(value));
    }
    // --- Value-surface input ---
    get source() {
        return this._source;
    }
    set source(value) {
        this._source = value;
        this._core.configure(this._options());
        this._core.setSource(value);
    }
    // --- Core delegated getters ---
    get value() {
        return this._core.value;
    }
    get fired() {
        return this._core.fired;
    }
    get pending() {
        return this._core.pending;
    }
    // --- Commands ---
    trigger(...args) {
        this._core.configure(this._options());
        this._core.trigger(...args);
    }
    cancel() {
        this._core.cancel();
    }
    flush() {
        this._core.flush();
    }
    // --- Internal ---
    // Overridden by <wcs-throttle> to bias the defaults toward throttle (leading
    // on, maxWait pinned to wait).
    _defaultWait() {
        return DEFAULT_WAIT;
    }
    // Resolves the effective `leading` value (not a static default). It is a method
    // rather than reading `this.leading` directly because <wcs-throttle> inverts the
    // default (on, opt out via `no-leading`) while sharing the inherited `leading`
    // attribute setter — overriding the getter alone would desync getter and setter.
    _resolveLeading() {
        return this.leading;
    }
    _defaultMaxWait() {
        return undefined;
    }
    _options() {
        return {
            wait: this.wait,
            leading: this._resolveLeading(),
            trailing: this.trailing,
            maxWait: this.maxWait,
        };
    }
    // --- Lifecycle ---
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        // §4.1/§4.4 Shell SSR: expose connectedCallbackPromise backed by observe().
        // observe() is a no-op resolving once ready (the engine is command-driven).
        this._connectedCallbackPromise = this._core.observe();
    }
    disconnectedCallback() {
        // Drop any in-flight timer so a detached element leaks nothing, and bump the
        // Core generation so a surviving timer callback cannot settle (§3.5).
        this._core.dispose();
    }
}

/**
 * `<wcs-throttle>` — the same {@link DebounceCore} engine biased to throttle:
 * `maxWait === wait` (a fire happens at least every `wait` ms under continuous
 * input) and `leading` on by default. It advertises its own `wcs-throttle:*`
 * event namespace (via `makeDebounceProperties("wcs-throttle")`), and the Core
 * dispatches under that prefix because the constructor passes it through.
 */
class Throttle extends Debounce {
    static eventPrefix = "wcs-throttle";
    static wcBindable = {
        ...Debounce.wcBindable,
        properties: makeDebounceProperties("wcs-throttle"),
    };
    // leading defaults on for throttle; `no-leading` opts out (symmetric with the
    // inherited `no-trailing`).
    _resolveLeading() {
        return !this.hasAttribute("no-leading");
    }
    // Pin maxWait to wait so throttle fires on a steady cadence; an explicit
    // `max-wait` attribute still overrides via the inherited getter.
    _defaultMaxWait() {
        return this.wait;
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.debounce)) {
        customElements.define(config.tagNames.debounce, Debounce);
    }
    if (!customElements.get(config.tagNames.throttle)) {
        customElements.define(config.tagNames.throttle, Throttle);
    }
}

function bootstrapDebounce(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { DebounceCore, Debounce as WcsDebounce, Throttle as WcsThrottle, bootstrapDebounce, getConfig, makeDebounceProperties };
//# sourceMappingURL=index.esm.js.map

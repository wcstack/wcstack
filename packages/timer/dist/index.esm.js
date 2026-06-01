const _config = {
    autoTrigger: true,
    triggerAttribute: "data-timertarget",
    tagNames: {
        timer: "wcs-timer",
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
 * Headless timer primitive. A thin, framework-agnostic wrapper around
 * `setInterval` exposed through the wc-bindable protocol: it streams `tick`
 * (a monotonically increasing counter), `elapsed` (running time in ms) and a
 * `running` flag, and is driven by the `start` / `stop` / `reset` / `pause` /
 * `resume` commands.
 *
 * `tick` and `elapsed` are both surfaced via the single `wcs-timer:tick` event
 * (read through getters, mirroring how FetchCore exposes value/status from one
 * `wcs-fetch:response` event), so an observer that binds either property is
 * notified on every fire.
 */
class TimerCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "tick", event: "wcs-timer:tick", getter: (e) => e.detail.count },
            { name: "elapsed", event: "wcs-timer:tick", getter: (e) => e.detail.elapsed },
            { name: "running", event: "wcs-timer:running-changed" },
        ],
        commands: [
            { name: "start" },
            { name: "stop" },
            { name: "reset" },
            { name: "pause" },
            { name: "resume" },
        ],
    };
    _target;
    _timerId = null;
    _tick = 0;
    _running = false;
    _paused = false;
    // `_tick` value captured at the start of the current run. `repeat` counts ticks
    // *per run*, so the stop condition compares against this baseline rather than the
    // cumulative `_tick` (which only resets on reset()). Without it, re-starting a
    // completed bounded timer would stop after a single tick.
    _runStartTick = 0;
    // Timer configuration (captured on start, reused by pause/resume).
    _interval = 1000;
    _repeat = 0; // 0 = unlimited
    _immediate = false;
    // Elapsed-time bookkeeping. `_accumulatedElapsed` holds the time folded from
    // already-finished running segments; `_segmentStart` is the timestamp the
    // current running segment began (null when not running). The live elapsed is
    // the sum of the two — see _currentElapsed().
    _accumulatedElapsed = 0;
    _segmentStart = null;
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get tick() {
        return this._tick;
    }
    get elapsed() {
        return this._currentElapsed();
    }
    get running() {
        return this._running;
    }
    // --- State setters with event dispatch ---
    _dispatchTick() {
        this._target.dispatchEvent(new CustomEvent("wcs-timer:tick", {
            detail: { count: this._tick, elapsed: this._currentElapsed() },
            bubbles: true,
        }));
    }
    _setRunning(running) {
        if (this._running === running)
            return;
        this._running = running;
        this._target.dispatchEvent(new CustomEvent("wcs-timer:running-changed", {
            detail: running,
            bubbles: true,
        }));
    }
    // --- Public API ---
    start(options = {}) {
        // Idempotent while running: a redundant start() must not stack a second
        // setInterval (which would leak and double the tick rate). Reconfiguring an
        // active timer is done via stop() + start().
        if (this._running)
            return;
        // start() begins a fresh running segment, so clear any lingering pause from a
        // prior pause()-without-resume(). Without this, the timer would run while
        // _paused stayed true, leaving pause() a no-op and letting resume() overwrite
        // the live timer handle (leak + double fire).
        this._paused = false;
        // `interval` is persistent configuration: a non-positive / non-finite value
        // (or an omitted option) keeps the previous interval (default 1000ms). The
        // guard rejects values that would turn setInterval into a hot loop and make
        // resume()'s `accumulated % interval` arithmetic produce NaN. The Shell already
        // falls back to 1000 for invalid attributes; this is the backstop for direct
        // Core API callers.
        if (typeof options.interval === "number" && Number.isFinite(options.interval) && options.interval > 0) {
            this._interval = options.interval;
        }
        // `repeat` / `immediate` are per-run intent, NOT persistent configuration:
        // every start() re-establishes them from the options, defaulting to
        // "unlimited" / "no immediate fire" when omitted. This keeps a bare start()
        // after a bounded or one-shot run from silently inheriting the old bounds.
        this._repeat = (typeof options.repeat === "number" && options.repeat > 0) ? options.repeat : 0;
        this._immediate = options.immediate === true;
        this._setRunning(true);
        this._segmentStart = Date.now();
        // Baseline this run's per-run repeat counting (set after _setRunning so a
        // re-start of a completed bounded timer fires the full N ticks again).
        this._runStartTick = this._tick;
        // Fire immediately on start when requested. _fire() may stop the timer (when
        // repeat is reached), so re-check _running before scheduling the interval.
        if (this._immediate) {
            this._fire();
        }
        if (this._running) {
            this._timerId = setInterval(this._fire, this._interval);
        }
    }
    stop() {
        this._clearTimer();
        this._foldElapsed();
        this._paused = false;
        this._setRunning(false);
    }
    reset() {
        this._clearTimer();
        this._paused = false;
        this._tick = 0;
        this._accumulatedElapsed = 0;
        this._segmentStart = null;
        this._setRunning(false);
        // Notify observers that the counter/elapsed have returned to zero.
        this._dispatchTick();
    }
    pause() {
        // Pause only a live timer; a no-op otherwise so it composes safely with the
        // declarative lifecycle. Unlike stop(), it records `_paused` so resume() can
        // tell an intentional pause from a full stop.
        if (!this._running || this._paused)
            return;
        this._clearTimer();
        this._foldElapsed();
        this._paused = true;
        this._setRunning(false);
    }
    resume() {
        if (!this._paused)
            return;
        this._paused = false;
        this._setRunning(true);
        this._segmentStart = Date.now();
        // Resume seamlessly: a tick fires every `interval` ms of *running* time, so
        // honour the partial period consumed before the pause. Wait only the
        // remainder to the next boundary, then fall back to the steady interval.
        // (`accumulated % interval === 0` — paused exactly on a boundary — yields a
        // full interval, which is correct: the next tick is a whole period away.)
        const remainder = this._interval - (this._accumulatedElapsed % this._interval);
        this._timerId = setTimeout(this._onResumeBoundary, remainder);
    }
    // --- Internal ---
    _onResumeBoundary = () => {
        this._timerId = null;
        this._fire();
        // _fire() may have auto-stopped the timer (repeat reached); only re-arm the
        // steady interval while still running.
        if (this._running) {
            this._timerId = setInterval(this._fire, this._interval);
        }
    };
    _fire = () => {
        this._tick++;
        this._dispatchTick();
        // Auto-stop once this run has fired the requested number of ticks (repeat=0
        // runs forever). Counted per-run via `_runStartTick`, so a re-start after a
        // completed bounded run fires N ticks again. `once` is expressed by the Shell
        // as repeat=1.
        if (this._repeat > 0 && (this._tick - this._runStartTick) >= this._repeat) {
            this._clearTimer();
            this._foldElapsed();
            this._setRunning(false);
        }
    };
    _clearTimer() {
        if (this._timerId !== null) {
            // `_timerId` may hold a setInterval handle (steady ticking) or a setTimeout
            // handle (the resume remainder). Clear both — per the HTML spec timers
            // share one list and clearTimeout/clearInterval each remove the entry
            // regardless of which call created it.
            clearTimeout(this._timerId);
            clearInterval(this._timerId);
            this._timerId = null;
        }
    }
    _foldElapsed() {
        if (this._segmentStart !== null) {
            this._accumulatedElapsed += Date.now() - this._segmentStart;
            this._segmentStart = null;
        }
    }
    _currentElapsed() {
        return this._accumulatedElapsed +
            (this._segmentStart !== null ? Date.now() - this._segmentStart : 0);
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
    const timerId = triggerElement.getAttribute(config.triggerAttribute);
    if (!timerId)
        return;
    // Resolve the registered constructor at call time instead of importing Timer
    // as a value. The value import created a components/Timer.ts ⇄ autoTrigger.ts
    // cycle (Timer.connectedCallback() calls registerAutoTrigger()). instanceof
    // against the customElements registry keeps the exact same identity guarantee
    // — only the registered <wcs-timer> class matches — without the import cycle.
    const TimerCtor = customElements.get(config.tagNames.timer);
    const timerElement = document.getElementById(timerId);
    if (!TimerCtor || !(timerElement instanceof TimerCtor))
        return;
    // Suppress the element's default action so a timer can start without
    // navigating. Intentional: do not attach data-timertarget to an element whose
    // default action you also want (real <a href> link, form-submit button) — it
    // will be cancelled. See README "Optional DOM Triggering".
    event.preventDefault();
    timerElement.start();
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

class Timer extends HTMLElement {
    static hasConnectedCallbackPromise = false;
    static wcBindable = {
        ...TimerCore.wcBindable,
        properties: [
            ...TimerCore.wcBindable.properties,
            { name: "trigger", event: "wcs-timer:trigger-changed" },
        ],
        // Shell-level settable surface. No `attribute` hints: these setters reflect
        // to their attributes themselves, so a binding system that mirrors
        // inputs[].attribute would set the attribute twice. `start` / `stop` /
        // `reset` / `pause` / `resume` commands are inherited from the Core above.
        inputs: [
            { name: "interval" },
            { name: "once" },
            { name: "repeat" },
            { name: "immediate" },
            { name: "manual" },
            { name: "trigger" },
        ],
    };
    static get observedAttributes() { return ["interval"]; }
    _core;
    _trigger = false;
    constructor() {
        super();
        this._core = new TimerCore(this);
    }
    // --- Attribute accessors ---
    get interval() {
        const attr = this.getAttribute("interval");
        const parsed = attr ? parseInt(attr, 10) : 1000;
        // Fall back to the 1000ms default for any invalid period — not only NaN but
        // also 0 / negative values, which would otherwise reach setInterval as a hot
        // loop and break resume()'s modulo arithmetic in the Core.
        return (Number.isFinite(parsed) && parsed > 0) ? parsed : 1000;
    }
    set interval(value) {
        this.setAttribute("interval", String(value));
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
    get repeat() {
        const attr = this.getAttribute("repeat");
        const parsed = attr ? parseInt(attr, 10) : 0;
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    set repeat(value) {
        this.setAttribute("repeat", String(value));
    }
    get immediate() {
        return this.hasAttribute("immediate");
    }
    set immediate(value) {
        if (value) {
            this.setAttribute("immediate", "");
        }
        else {
            this.removeAttribute("immediate");
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
    get tick() {
        return this._core.tick;
    }
    get elapsed() {
        return this._core.elapsed;
    }
    get running() {
        return this._core.running;
    }
    // --- Command property ---
    get trigger() {
        return this._trigger;
    }
    set trigger(value) {
        // Momentary command-property: a false→true write starts the timer. Mirrors
        // the trigger flag on <wcs-fetch> / <wcs-ws>. Prefer the command-token
        // protocol (`command.start: $command.tick`) for state-driven starts; this
        // exists mainly for the DOM click trigger and simple boolean bindings.
        const v = !!value;
        if (v) {
            this._trigger = true;
            this.start();
            this._trigger = false;
            this.dispatchEvent(new CustomEvent("wcs-timer:trigger-changed", {
                detail: false,
                bubbles: true,
            }));
        }
    }
    // --- Commands ---
    start() {
        // `once` is sugar for "fire exactly one tick": map it to repeat=1, but let an
        // explicit repeat attribute win when both are present.
        const repeat = this.repeat > 0 ? this.repeat : (this.once ? 1 : 0);
        this._core.start({
            interval: this.interval,
            repeat,
            immediate: this.immediate,
        });
    }
    stop() {
        this._core.stop();
    }
    reset() {
        this._core.reset();
    }
    pause() {
        this._core.pause();
    }
    resume() {
        this._core.resume();
    }
    // --- Lifecycle ---
    attributeChangedCallback(name, oldValue, newValue) {
        // Live interval changes restart the underlying setInterval with the new
        // period (count/elapsed are preserved). Only act on a real change to a
        // running, declaratively-driven timer.
        if (name === "interval" && oldValue !== newValue && this.isConnected && !this.manual && this.running) {
            this._core.stop();
            this.start();
        }
    }
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        if (!this.manual) {
            this.start();
        }
    }
    disconnectedCallback() {
        this._core.stop();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.timer)) {
        customElements.define(config.tagNames.timer, Timer);
    }
}

function bootstrapTimer(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { TimerCore, Timer as WcsTimer, bootstrapTimer, getConfig };
//# sourceMappingURL=index.esm.js.map

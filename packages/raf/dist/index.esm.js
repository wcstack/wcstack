const _config = {
    autoTrigger: true,
    triggerAttribute: "data-raftarget",
    tagNames: {
        raf: "wcs-raf",
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
// Internal-only live handle to the mutable config. NOT part of the public API
// (deliberately absent from exports.ts) — it is exported solely so sibling
// modules in this package can read current settings cheaply. External consumers
// must use getConfig() (returns a deep-frozen snapshot) / setConfig(). Mutating
// this object directly bypasses the frozenConfig cache and is unsupported.
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
 * Headless requestAnimationFrame primitive — `TimerCore`'s sibling with the
 * time source swapped from `setInterval` (a period) to rAF (the browser's
 * rendering opportunity). Exposed through the wc-bindable protocol: it streams
 * `tick` (frame counter), `elapsed` (accumulated ACTIVE milliseconds), `dt`
 * (delta to the previous frame) and the `running` / `suspended` pair, and is
 * driven by the `start` / `stop` / `reset` / `pause` / `resume` commands.
 *
 * `tick` / `elapsed` / `dt` are all surfaced via the single `wcs-raf:tick`
 * event (read through getters, mirroring how FetchCore exposes value/status
 * from one `wcs-fetch:response` event).
 *
 * Contracts specific to this node (docs/raf-tag-design.md):
 *
 * - **dt describes continuous running only.** The first frame after `start()`,
 *   `resume()`, or a visibility interruption reports `dt = 0` — a value that
 *   spans an interruption never reaches observers. There is deliberately NO
 *   upper clamp: how to treat a slow frame is the consumer's domain decision.
 * - **elapsed is Σdt (active time).** Because interruption-spanning deltas are
 *   normalized to 0, summing dt yields exactly the time frames were actually
 *   being delivered — no separate segment bookkeeping is needed, and hidden /
 *   paused periods contribute nothing. Granularity is one frame: between
 *   frames the getter returns the value as of the last tick.
 * - **running / suspended are a desired/actual pair** (the wakelock split): in
 *   a hidden tab the browser delivers no frames at all, so `running` (the
 *   started intent) stays true while `suspended` reports that delivery is
 *   actually stopped. `suspended` is only meaningful after `observe()` has
 *   subscribed to `visibilitychange`; without a document it stays false.
 * - **No `error` surface.** rAF has no persistent failure mode; on a platform
 *   without it, `start()` is a silent no-op (never-throw, resize precedent).
 */
class RafCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "tick", event: "wcs-raf:tick", getter: (e) => e.detail.count },
            { name: "elapsed", event: "wcs-raf:tick", getter: (e) => e.detail.elapsed },
            { name: "dt", event: "wcs-raf:tick", getter: (e) => e.detail.dt },
            { name: "running", event: "wcs-raf:running-changed" },
            { name: "suspended", event: "wcs-raf:suspended-changed" },
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
    _injectedScheduler;
    _handle = null;
    // Generation guard (§3.4): bumped on dispose() and at every scheduled run
    // (start()/resume()). A frame callback captures the generation live via
    // `_gen`; a frame that was already queued when the node was torn down — or
    // superseded by a new run — has a stale gen and MUST NOT mutate state or
    // dispatch on a disposed element. _clearHandle() cancels the handle, but the
    // guard is the belt-and-braces defense for a callback already in flight.
    _gen = 0;
    _runGen = 0;
    // SSR (§3.8): there is no asynchronous probe, so readiness is immediate.
    _ready = Promise.resolve();
    _tick = 0;
    _dt = 0;
    _elapsed = 0;
    _running = false;
    _suspended = false;
    _paused = false;
    // Timestamp of the previous frame within the current continuous run.
    // `null` means "the next frame starts a run segment": its dt is reported as
    // 0 (the G3 normalization). Cleared at start()/resume() and on every
    // visibilitychange (an interruption boundary).
    _lastTs = null;
    // `_tick` value captured at the start of the current run. `repeat` counts
    // frames *per run*, so the stop condition compares against this baseline
    // rather than the cumulative `_tick` (which only resets on reset()).
    _repeat = 0;
    _runStartTick = 0;
    // The document whose visibility drives `suspended`, subscribed in observe()
    // and released in dispose(). Null before observe() or in non-DOM
    // environments — `suspended` then simply stays false.
    _visibilityDoc = null;
    constructor(target, scheduler) {
        super();
        this._target = target ?? this;
        this._injectedScheduler = scheduler ?? null;
    }
    get tick() {
        return this._tick;
    }
    get elapsed() {
        return this._elapsed;
    }
    get dt() {
        return this._dt;
    }
    get running() {
        return this._running;
    }
    get suspended() {
        return this._suspended;
    }
    // SSR readiness (§3.8): resolves after the first probe. There is nothing to
    // probe, so this is an already-resolved promise.
    get ready() {
        return this._ready;
    }
    // Lifecycle (§3.5). observe() establishes the one ambient subscription this
    // node has — `visibilitychange`, which drives the `suspended` output and the
    // dt=0 normalization across a hidden period. Idempotent; a no-op without a
    // document (SSR pre-pass, worker). dispose() tears everything down and bumps
    // the generation so a frame already queued cannot fire onto a torn-down
    // element.
    observe() {
        if (this._visibilityDoc === null && typeof document !== "undefined") {
            this._visibilityDoc = document;
            document.addEventListener("visibilitychange", this._onVisibilityChange);
        }
        return this._ready;
    }
    dispose() {
        this._gen++;
        this.stop();
        if (this._visibilityDoc !== null) {
            this._visibilityDoc.removeEventListener("visibilitychange", this._onVisibilityChange);
            this._visibilityDoc = null;
        }
    }
    // --- State setters with event dispatch ---
    _dispatchTick(timestamp) {
        this._target.dispatchEvent(new CustomEvent("wcs-raf:tick", {
            detail: { count: this._tick, elapsed: this._elapsed, dt: this._dt, timestamp },
            bubbles: true,
        }));
    }
    _setRunning(running) {
        if (this._running === running)
            return;
        this._running = running;
        this._target.dispatchEvent(new CustomEvent("wcs-raf:running-changed", {
            detail: running,
            bubbles: true,
        }));
        // `suspended` is derived from (running && hidden), so every running
        // transition re-evaluates it: stop/pause drop a suspension, and a start()
        // inside an already-hidden tab reports it immediately (honestly: no frame
        // will arrive until the tab is visible again).
        this._updateSuspended();
    }
    _setSuspended(suspended) {
        if (this._suspended === suspended)
            return;
        this._suspended = suspended;
        this._target.dispatchEvent(new CustomEvent("wcs-raf:suspended-changed", {
            detail: suspended,
            bubbles: true,
        }));
    }
    _updateSuspended() {
        const hidden = this._visibilityDoc !== null && this._visibilityDoc.visibilityState === "hidden";
        this._setSuspended(this._running && hidden);
    }
    // --- Public API ---
    start(options = {}) {
        // Idempotent while running: a redundant start() must not stack a second
        // frame loop (which would double the tick rate). Reconfiguring an active
        // run is done via stop() + start().
        if (this._running)
            return;
        // Resolve the platform API at call time (§3.7). Absent rAF (SSR pre-pass,
        // worker) makes start() a silent no-op — never-throw, and this node has no
        // error surface by design.
        const scheduler = this._resolveScheduler();
        if (scheduler === null)
            return;
        // start() begins a fresh run, so clear any lingering pause from a prior
        // pause()-without-resume(). Without this, the loop would run while _paused
        // stayed true, leaving pause() a no-op and letting resume() overwrite the
        // live handle (leak + double fire).
        this._paused = false;
        // `repeat` is per-run intent, NOT persistent configuration: every start()
        // re-establishes it from the options, defaulting to "unlimited" when
        // omitted. This keeps a bare start() after a bounded run from silently
        // inheriting the old bounds.
        this._repeat = (typeof options.repeat === "number" && options.repeat > 0) ? options.repeat : 0;
        this._setRunning(true);
        // Baseline this run's per-run repeat counting (set after _setRunning so a
        // re-start of a completed bounded run fires the full N frames again).
        this._runStartTick = this._tick;
        // G3: the first frame of a run reports dt = 0.
        this._lastTs = null;
        // Capture this run's generation (§3.4).
        this._runGen = ++this._gen;
        this._handle = scheduler.request(this._frame);
    }
    stop() {
        this._clearHandle();
        this._paused = false;
        this._setRunning(false);
    }
    reset() {
        this._clearHandle();
        this._paused = false;
        this._tick = 0;
        this._elapsed = 0;
        this._dt = 0;
        this._lastTs = null;
        this._setRunning(false);
        // Notify observers that the counter/elapsed/dt have returned to zero. The
        // notification is not a frame, so `timestamp` is 0 (see WcsRafTickDetail).
        this._dispatchTick(0);
    }
    pause() {
        // Pause only a live loop; a no-op otherwise so it composes safely with the
        // declarative lifecycle. Unlike stop(), it records `_paused` so resume()
        // can tell an intentional pause from a full stop. No elapsed bookkeeping
        // is needed: elapsed is Σdt, and the resume boundary's dt is 0.
        if (!this._running || this._paused)
            return;
        this._clearHandle();
        this._paused = true;
        this._setRunning(false);
    }
    resume() {
        if (!this._paused)
            return;
        const scheduler = this._resolveScheduler();
        if (scheduler === null)
            return;
        this._paused = false;
        this._setRunning(true);
        // G3: the first frame after a pause reports dt = 0 (elapsed therefore does
        // not count the paused period — the "active time" contract).
        this._lastTs = null;
        // New scheduled run after a pause: capture its generation (§3.4).
        this._runGen = ++this._gen;
        this._handle = scheduler.request(this._frame);
    }
    // --- Internal ---
    _frame = (timestamp) => {
        // Stale-run guard (§3.4): a frame queued before dispose() (which bumps
        // `_gen`) must not tick or dispatch onto a torn-down element.
        if (this._runGen !== this._gen)
            return;
        this._handle = null;
        // dt: delta to the previous frame within this continuous run; 0 when this
        // frame opens a segment (start/resume/visibility boundary — G3).
        const dt = this._lastTs === null ? 0 : timestamp - this._lastTs;
        this._lastTs = timestamp;
        this._tick++;
        this._dt = dt;
        this._elapsed += dt;
        this._dispatchTick(timestamp);
        // Auto-stop once this run has fired the requested number of frames
        // (repeat=0 runs forever). Counted per-run via `_runStartTick`, so a
        // re-start after a completed bounded run fires N frames again. `once` is
        // expressed by the Shell as repeat=1.
        if (this._repeat > 0 && (this._tick - this._runStartTick) >= this._repeat) {
            this._setRunning(false);
            return;
        }
        // Re-request the next frame — unless a tick listener stopped the loop
        // synchronously during the dispatch above.
        if (this._running) {
            const scheduler = this._resolveScheduler();
            if (scheduler !== null) {
                this._handle = scheduler.request(this._frame);
            }
        }
    };
    _onVisibilityChange = () => {
        // Either direction is an interruption boundary: entering hidden means the
        // browser stops delivering frames, so the NEXT delivered frame must not
        // report a delta spanning the gap (G3). Clearing on the visible edge too
        // is belt-and-braces for a missed hidden event — the worst case is one
        // extra dt=0 frame.
        this._lastTs = null;
        this._updateSuspended();
    };
    _resolveScheduler() {
        if (this._injectedScheduler !== null)
            return this._injectedScheduler;
        const g = globalThis;
        if (typeof g.requestAnimationFrame !== "function" || typeof g.cancelAnimationFrame !== "function") {
            return null;
        }
        return {
            request: (cb) => g.requestAnimationFrame(cb),
            cancel: (handle) => g.cancelAnimationFrame(handle),
        };
    }
    _clearHandle() {
        if (this._handle !== null) {
            this._resolveScheduler()?.cancel(this._handle);
            this._handle = null;
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
    const rafId = triggerElement.getAttribute(config.triggerAttribute);
    if (!rafId)
        return;
    // Resolve the registered constructor at call time instead of importing Raf
    // as a value. The value import created a components/Raf.ts ⇄ autoTrigger.ts
    // cycle (Raf.connectedCallback() calls registerAutoTrigger()). instanceof
    // against the customElements registry keeps the exact same identity guarantee
    // — only the registered <wcs-raf> class matches — without the import cycle.
    const RafCtor = customElements.get(config.tagNames.raf);
    const rafElement = document.getElementById(rafId);
    if (!RafCtor || !(rafElement instanceof RafCtor))
        return;
    // Suppress the element's default action so a loop can start without
    // navigating. Intentional: do not attach data-raftarget to an element whose
    // default action you also want (real <a href> link, form-submit button) — it
    // will be cancelled. See README "Optional DOM Triggering".
    event.preventDefault();
    rafElement.start();
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

class Raf extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...RafCore.wcBindable,
        properties: [
            ...RafCore.wcBindable.properties,
            { name: "trigger", event: "wcs-raf:trigger-changed" },
        ],
        // Shell-level settable surface. `attribute` is a purely descriptive hint
        // (per SPEC-extensions.md the binding core does not act on it) naming the
        // mirrored HTML attribute, matching <wcs-timer>. `trigger` is a momentary
        // command-property with no backing attribute, so it carries no hint.
        // `start` / `stop` / `reset` / `pause` / `resume` commands are inherited
        // from the Core above. Deliberately absent vs <wcs-timer>: `interval`
        // (rAF has no period) and `immediate` (the first frame already IS the
        // next rendering opportunity — no earlier meaningful moment exists).
        inputs: [
            { name: "once", attribute: "once" },
            { name: "repeat", attribute: "repeat" },
            { name: "manual", attribute: "manual" },
            { name: "trigger" },
        ],
    };
    _core;
    _trigger = false;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new RafCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-raf:running-changed": (d) => ({ running: d === true }),
            "wcs-raf:suspended-changed": (d) => ({ suspended: d === true }),
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
    // SSR (§4.1/§4.4): the Shell exposes the Core's readiness so a server-side
    // renderer can await the connect-time probe before snapshotting. There is no
    // async probe here (observe() resolves immediately), but the contract is
    // uniform across IO nodes.
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // --- Attribute accessors ---
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
        if (attr === null || attr.trim() === "")
            return 0;
        // Strict parse via Number() ("3px" -> NaN, not 3), matching <wcs-timer>.
        // Normalise any non-positive / non-numeric value to 0 (= unlimited).
        const parsed = Number(attr);
        return (Number.isFinite(parsed) && parsed > 0) ? parsed : 0;
    }
    set repeat(value) {
        this.setAttribute("repeat", String(value));
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
    get dt() {
        return this._core.dt;
    }
    get running() {
        return this._core.running;
    }
    get suspended() {
        return this._core.suspended;
    }
    // --- Command property ---
    get trigger() {
        return this._trigger;
    }
    set trigger(value) {
        // Momentary command-property: a false→true write starts the loop. Mirrors
        // <wcs-timer>. Prefer the command-token protocol (`command.start:
        // $command.begin`) for state-driven starts; this exists mainly for the DOM
        // click trigger and simple boolean bindings.
        const v = !!value;
        if (v) {
            this._trigger = true;
            this.start();
            this._trigger = false;
            // The `trigger-changed` event reports the momentary flag returning to
            // false, i.e. that the trigger property *changed* — it is deliberately
            // not gated on whether start() actually began a new run (same contract
            // as <wcs-timer>).
            this.dispatchEvent(new CustomEvent("wcs-raf:trigger-changed", {
                detail: false,
                bubbles: true,
            }));
        }
    }
    // --- Commands ---
    start() {
        // `once` is sugar for "fire exactly one frame": map it to repeat=1, but
        // let an explicit repeat attribute win when both are present.
        const repeat = this.repeat > 0 ? this.repeat : (this.once ? 1 : 0);
        this._core.start({ repeat });
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
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        // Establish monitoring (§3.5): observe() subscribes visibilitychange (the
        // `suspended` output) and resolves once ready; expose it as
        // connectedCallbackPromise for SSR. Note for SSR pages: an auto-started
        // frame loop keeps scheduling — prefer `manual` in server-rendered markup
        // (see README).
        this._connectedCallbackPromise = this._core.observe();
        if (!this.manual) {
            this.start();
        }
    }
    disconnectedCallback() {
        // dispose() stops the loop, releases the visibility subscription and bumps
        // the generation so a frame already queued cannot fire onto a disconnected
        // element (§3.5 / §4.4).
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.raf)) {
        customElements.define(config.tagNames.raf, Raf);
    }
}

function bootstrapRaf(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { RafCore, Raf as WcsRaf, bootstrapRaf, getConfig };
//# sourceMappingURL=index.esm.js.map

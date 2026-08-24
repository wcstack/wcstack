const _config = {
    tagNames: {
        viewTransition: "wcs-view-transition",
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
// Note: this is the live, mutable internal config. It is not part of the public
// package exports (see exports.ts) — only `getConfig()` (a frozen snapshot) is
// surfaced. `setConfig()` is applied internally via `bootstrapViewTransition()` and
// is not re-exported from the package root, though a deep path import
// (`.../src/config.js`) can still reach and mutate it. Accepted as-is for
// cross-package consistency: every @wcstack package follows this same shape.
// Use `getConfig()` for a frozen, safe read.
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

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/transition-runner.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
// transition-runner protocol — how a package that mutates the DOM hands that
// mutation to whoever is arbitrating view transitions on the page.
//
// @wcstack/state and @wcstack/router must not depend on @wcstack/view-transition
// (zero runtime dependencies, independently publishable), so the arbiter installs
// itself on a well-known global symbol and the participants look it up lazily.
// No arbiter installed means the mutation is invoked directly, synchronously —
// byte-for-byte the behavior these packages had before the protocol existed.
//
// docs/view-transition-design.md §4 is the normative description.
//
// SINGLE SOURCE OF TRUTH: edit only this file (/protocol/transition-runner.ts), then run
// `node scripts/sync-protocol-types.mjs` to regenerate the per-package copies
// (packages/<pkg>/src/protocol/transitionRunner.ts). Those copies are generated — do not edit them.
/**
 * Global key the arbiter installs itself under. `Symbol.for` so independently
 * loaded copies of this file (two CDN bundles on one page) still agree.
 */
const TRANSITION_RUNNER_KEY = Symbol.for("wcstack.transition-runner");
/**
 * The installed arbiter, or null when there is none, it speaks a version this
 * reader does not, or it does not accept this participant.
 *
 * Looked up on every call rather than cached: the tag can be added, removed, or
 * reconfigured at any point in a page's life, and a stale cache would either
 * animate what the author just switched off or miss what they switched on.
 */
function getTransitionRunner(source) {
    const candidate = globalThis[TRANSITION_RUNNER_KEY];
    if (candidate === undefined || candidate === null)
        return null;
    if (candidate.protocol !== "wcs-transition-runner")
        return null;
    if (typeof candidate.version !== "number" || candidate.version < 1)
        return null;
    if (typeof candidate.run !== "function")
        return null;
    if (typeof candidate.accepts !== "function" || !candidate.accepts(source))
        return null;
    return candidate;
}
/**
 * Run `mutate` under the installed arbiter, or directly when there is none.
 *
 * Returns `undefined` in the no-arbiter case instead of a resolved promise: the
 * state drain calls this on every batch, and awaiting is a caller's choice, not
 * an allocation the common path should pay for. `await` accepts both.
 */
function runTransition(source, mutate, types) {
    const runner = getTransitionRunner(source);
    if (runner === null) {
        mutate();
        return undefined;
    }
    return runner.run(mutate, { source, types });
}

const DEFAULT_NAMING_LIMIT = 200;
const DEFAULT_PARTICIPANTS = ["router", "state"];
function toError(value) {
    return value instanceof Error ? value : new Error(String(value));
}
function prefersReducedMotion() {
    // never-throw: matchMedia is absent in happy-dom and in non-browser hosts.
    try {
        const mm = globalThis.matchMedia;
        if (typeof mm !== "function")
            return false;
        return mm.call(globalThis, "(prefers-reduced-motion: reduce)").matches === true;
    }
    catch {
        return false;
    }
}
/**
 * Whether `startViewTransition({ update, types })` is understood. Detected on
 * `ViewTransition.prototype`, because passing the object form to an
 * implementation that only accepts a callback would throw at the call site —
 * after the browser has already decided it has no update callback to run.
 */
function supportsTypes() {
    try {
        const ctor = globalThis.ViewTransition;
        return ctor !== undefined && "types" in ctor.prototype;
    }
    catch {
        return false;
    }
}
/**
 * Headless view-transition arbiter — the single place on a page that decides
 * whether a DOM mutation animates, and what happens when two of them collide.
 *
 * It is not an I/O node: nothing is read from a device and there is no data to
 * bind. It is a *policy* node. Participants (`@wcstack/router`, `@wcstack/state`)
 * never import it; they find it through the transition-runner protocol on a
 * well-known global symbol and hand it a mutation to run
 * (docs/view-transition-design.md §4).
 *
 * The one invariant everything else is subordinate to: **a mutation handed to
 * `run()` is applied exactly once**, whatever is decided about animating it. An
 * unsupported browser, a hidden tab, reduced motion, a colliding transition and a
 * `startViewTransition` that throws all end in the mutation running — the page
 * must never be left showing stale DOM because an animation could not be played.
 */
class ViewTransitionCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "active", event: "wcs-view-transition:active-changed", semantics: "state" },
            { name: "error", event: "wcs-view-transition:error", semantics: "state" },
        ],
        commands: [
            { name: "skip" },
        ],
    };
    _target;
    _mode = "latest";
    _naming = "manual";
    _namingLimit = DEFAULT_NAMING_LIMIT;
    _reducedMotion = "skip";
    _types = [];
    _disabled = false;
    _participants = new Set(DEFAULT_PARTICIPANTS);
    _active = false;
    _error = null;
    /** Requests waiting for the microtask flush that starts a transition. */
    _pending = null;
    _flushScheduled = false;
    /**
     * The batch handed to the running transition while its update callback has not
     * fired yet. Non-null means "capturing": a request arriving now still joins this
     * batch, which is both the coalescing window and the only ordering guarantee
     * that keeps a later `exhaust`/`latest` request from applying ahead of it.
     */
    _batch = null;
    _transition = null;
    _queue = [];
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    // --- transition-runner protocol surface ---
    get protocol() {
        return "wcs-transition-runner";
    }
    get version() {
        return 1;
    }
    get naming() {
        return this._naming;
    }
    set naming(value) {
        this._naming = value === "auto" ? "auto" : "manual";
    }
    get namingLimit() {
        return this._namingLimit;
    }
    set namingLimit(value) {
        this._namingLimit = Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_NAMING_LIMIT;
    }
    accepts(source) {
        return this._participants.has(source);
    }
    /**
     * Install this core as the page's arbiter. Returns false (and warns) when
     * another one already holds the slot — two arbiters would each think they own
     * the exclusion, which is precisely the thing an arbiter exists to prevent.
     */
    install() {
        const slot = globalThis;
        const current = slot[TRANSITION_RUNNER_KEY];
        if (current !== undefined && current !== null && current !== this) {
            console.warn("[@wcstack/view-transition] a transition runner is already installed; " +
                "this element is inert. Use one <wcs-view-transition> per document.");
            return false;
        }
        slot[TRANSITION_RUNNER_KEY] = this;
        return true;
    }
    /** Release the arbiter slot, but only if it is still ours. */
    uninstall() {
        const slot = globalThis;
        if (slot[TRANSITION_RUNNER_KEY] === this) {
            delete slot[TRANSITION_RUNNER_KEY];
        }
    }
    // --- configuration ---
    get mode() {
        return this._mode;
    }
    set mode(value) {
        this._mode = value === "queue" || value === "exhaust" ? value : "latest";
    }
    get reducedMotion() {
        return this._reducedMotion;
    }
    set reducedMotion(value) {
        this._reducedMotion = value === "animate" ? "animate" : "skip";
    }
    get types() {
        return this._types;
    }
    set types(value) {
        this._types = value.slice();
    }
    get disabled() {
        return this._disabled;
    }
    set disabled(value) {
        this._disabled = value === true;
    }
    get participants() {
        return [...this._participants];
    }
    set participants(value) {
        this._participants = new Set(value.length > 0 ? value : DEFAULT_PARTICIPANTS);
    }
    // --- observable outputs ---
    get active() {
        return this._active;
    }
    get error() {
        return this._error;
    }
    // --- commands ---
    /**
     * Finish the running transition now. Per spec the update callback still runs if
     * it has not yet, so skipping loses the animation and never the DOM update.
     */
    skip() {
        this._transition?.skipTransition();
    }
    // --- the protocol entry point ---
    run(mutate, _options) {
        if (!this._canTransition()) {
            return this._applyNow(mutate);
        }
        return new Promise((resolve, reject) => {
            const entry = { mutate, resolve, reject };
            // Capturing: the running transition has not called its update callback yet,
            // so this mutation can still ride along — and must, or it would be applied
            // before mutations that were requested earlier.
            if (this._batch !== null) {
                this._batch.push(entry);
                return;
            }
            if (this._transition !== null && this._mode === "exhaust") {
                this._settle(entry);
                return;
            }
            (this._pending ??= []).push(entry);
            this._schedule();
        });
    }
    dispose() {
        this.uninstall();
        // Anything still queued belongs to a page that is going away; apply it so the
        // DOM does not stay behind the state that asked for the change.
        const abandoned = [...(this._pending ?? []), ...this._queue.flat()];
        this._pending = null;
        this._queue = [];
        for (const entry of abandoned) {
            this._settle(entry);
        }
    }
    // --- internals ---
    _canTransition() {
        if (this._disabled)
            return false;
        const doc = globalThis.document;
        if (doc === undefined || typeof doc.startViewTransition !== "function") {
            return false;
        }
        // A hidden tab gets no rendering opportunities, so the update callback would
        // not run until the page is looked at again — the DOM would silently freeze
        // for as long as the tab stays in the background. Apply straight through.
        if (doc.hidden === true)
            return false;
        if (this._reducedMotion === "skip" && prefersReducedMotion())
            return false;
        return true;
    }
    _applyNow(mutate) {
        try {
            mutate();
        }
        catch (error) {
            return Promise.reject(error);
        }
        return Promise.resolve();
    }
    _settle(entry) {
        try {
            entry.mutate();
            entry.resolve();
        }
        catch (error) {
            entry.reject(error);
        }
    }
    _schedule() {
        if (this._flushScheduled)
            return;
        this._flushScheduled = true;
        queueMicrotask(() => this._flush());
    }
    _flush() {
        this._flushScheduled = false;
        const batch = this._pending;
        this._pending = null;
        if (batch === null || batch.length === 0)
            return;
        if (this._transition !== null) {
            if (this._mode === "queue") {
                this._queue.push(batch);
                return;
            }
            if (this._mode === "exhaust") {
                for (const entry of batch) {
                    this._settle(entry);
                }
                return;
            }
            // "latest": starting a new transition skips the running one, and the
            // running one is past its update callback (a capturing batch is joined in
            // run(), never reaching here), so ordering holds.
        }
        this._start(batch);
    }
    _start(batch) {
        const doc = globalThis.document;
        const start = doc.startViewTransition;
        this._batch = batch;
        const update = () => {
            const running = this._batch;
            this._batch = null;
            if (running === null)
                return;
            for (const entry of running) {
                this._settle(entry);
            }
        };
        let transition;
        try {
            transition = this._types.length > 0 && supportsTypes()
                ? start.call(doc, { update, types: [...this._types] })
                : start.call(doc, update);
        }
        catch (error) {
            // Could not even start: apply the mutations rather than lose them.
            this._batch = null;
            this._setError(toError(error));
            for (const entry of batch) {
                this._settle(entry);
            }
            return;
        }
        this._transition = transition;
        this._setError(null);
        this._setActive(true);
        // `finished` rejects when the update callback throws — it cannot here, since
        // _settle catches per entry — and `ready` rejects whenever the transition is
        // skipped, which is routine. Both are attached defensively so a routine skip
        // never surfaces as an unhandled rejection.
        const done = () => this._onFinished(transition);
        transition.finished.then(done, done);
        transition.ready.then(undefined, () => { });
        transition.updateCallbackDone.then(undefined, () => { });
    }
    _onFinished(transition) {
        // A superseded transition ("latest") still settles; only the current one owns
        // the active flag and the queue.
        if (this._transition !== transition)
            return;
        this._transition = null;
        this._setActive(false);
        const next = this._queue.shift();
        if (next !== undefined) {
            this._start(next);
        }
    }
    _setActive(value) {
        if (this._active === value)
            return;
        this._active = value;
        this._dispatch("wcs-view-transition:active-changed", value);
    }
    _setError(error) {
        if (this._error === error)
            return;
        this._error = error;
        this._dispatch("wcs-view-transition:error", error);
    }
    _dispatch(type, detail) {
        this._target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    }
}

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/upgrade-properties.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
function hasAccessorOnPrototype(target, name) {
    let proto = Object.getPrototypeOf(target);
    while (proto !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (descriptor !== undefined) {
            return typeof descriptor.get === "function" || typeof descriptor.set === "function";
        }
        proto = Object.getPrototypeOf(proto);
    }
    return false;
}
/**
 * `connectedCallback` の先頭で呼ぶ。宣言済み input のうち upgrade 前の代入で
 * accessor をシャドウしている own プロパティを、delete → 再代入で setter に通し直す。
 *
 * - 冪等: 再代入は accessor を通るので own プロパティは残らず、2 回目以降は no-op。
 * - 宣言に `inputs` が無い要素、`wcBindable` を持たない要素では何もしない。
 * - 値の意味は変えない。今まで捨てられていた代入が届くようになる一方向の変化。
 */
function upgradeProperties(element) {
    const declaration = element.constructor?.wcBindable;
    const inputs = declaration?.inputs;
    if (inputs === undefined)
        return;
    for (const input of inputs) {
        const name = input.name;
        if (!Object.prototype.hasOwnProperty.call(element, name))
            continue;
        if (!hasAccessorOnPrototype(element, name))
            continue;
        const record = element;
        const value = record[name];
        delete record[name];
        record[name] = value;
    }
}

function parseList(value) {
    if (value === null)
        return [];
    return value.split(/\s+/).filter((token) => token !== "");
}
function toList(value) {
    return typeof value === "string" ? parseList(value) : [...value];
}
/**
 * `<wcs-view-transition>` — the page's view-transition policy node.
 *
 * It renders nothing and binds no data. It declares *how* the DOM changes that
 * `@wcstack/router` and `@wcstack/state` make should animate, and it is the single
 * arbiter that decides what happens when two of those changes collide. Dropping
 * the tag on a page is the opt-in; removing it restores the framework's original
 * synchronous behavior exactly (docs/view-transition-design.md §3, G1/G2).
 *
 * ```html
 * <wcs-view-transition for="router" mode="latest"></wcs-view-transition>
 * ```
 *
 * The animation itself is written in CSS against `::view-transition-*`. This tag
 * starts and arbitrates transitions; it never describes one.
 */
class WcsViewTransition extends HTMLElement {
    static observedAttributes = [
        "mode", "naming", "naming-limit", "reduced-motion", "types", "disabled", "for",
    ];
    static wcBindable = {
        ...ViewTransitionCore.wcBindable,
        inputs: [
            { name: "disabled", attribute: "disabled" },
            { name: "mode", attribute: "mode" },
            { name: "naming", attribute: "naming" },
            { name: "namingLimit", attribute: "naming-limit" },
            { name: "reducedMotion", attribute: "reduced-motion" },
            { name: "types", attribute: "types" },
            { name: "participants", attribute: "for" },
        ],
        // Inherited from the Core so a command added there cannot be missed here.
        commands: ViewTransitionCore.wcBindable.commands,
    };
    _core;
    _internals = null;
    _installed = false;
    constructor() {
        super();
        this._core = new ViewTransitionCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-view-transition:active-changed": (d) => ({ active: d === true }),
            "wcs-view-transition:error": (d) => ({ error: d != null }),
        });
    }
    /** The headless arbiter, for direct (non-DOM) use. */
    get core() {
        return this._core;
    }
    // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
    // wc-bindable. MUST NOT return the live CustomStateSet.
    get debugStates() {
        return this._internals ? [...this._internals.states] : [];
    }
    _initInternals() {
        // never-throw: attachInternals is absent in happy-dom / older environments,
        // and pre-125 Chromium rejects non-dashed state names (probed and discarded).
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
    // --- inputs ---
    get disabled() {
        return this._core.disabled;
    }
    set disabled(value) {
        this._core.disabled = value === true;
        this.toggleAttribute("disabled", value === true);
    }
    get mode() {
        return this._core.mode;
    }
    set mode(value) {
        this._core.mode = value;
    }
    get naming() {
        return this._core.naming;
    }
    set naming(value) {
        this._core.naming = value;
    }
    get namingLimit() {
        return this._core.namingLimit;
    }
    set namingLimit(value) {
        this._core.namingLimit = Number(value);
    }
    get reducedMotion() {
        return this._core.reducedMotion;
    }
    set reducedMotion(value) {
        this._core.reducedMotion = value;
    }
    get types() {
        return this._core.types;
    }
    set types(value) {
        this._core.types = toList(value);
    }
    get participants() {
        return this._core.participants;
    }
    set participants(value) {
        this._core.participants = toList(value);
    }
    // --- observable outputs ---
    get active() {
        return this._core.active;
    }
    get error() {
        return this._core.error;
    }
    // --- commands ---
    skip() {
        this._core.skip();
    }
    // --- lifecycle ---
    connectedCallback() {
        upgradeProperties(this);
        this._syncAllAttributes();
        this._installed = this._core.install();
    }
    disconnectedCallback() {
        if (this._installed) {
            this._core.uninstall();
            this._installed = false;
        }
    }
    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue)
            return;
        this._applyAttribute(name, newValue);
    }
    /**
     * Apply the attributes present at connect time. Absent ones are deliberately
     * skipped rather than applied as null: a property assigned before upgrade
     * (Angular's `[prop]`, Lit's `.prop=`, or plain `el.mode = ...`) has just been
     * replayed through the setter by `upgradeProperties`, and re-applying a missing
     * attribute would immediately reset it to the default. Removing an attribute
     * still resets, via `attributeChangedCallback`.
     */
    _syncAllAttributes() {
        for (const name of WcsViewTransition.observedAttributes) {
            const value = this.getAttribute(name);
            if (value === null)
                continue;
            this._applyAttribute(name, value);
        }
    }
    _applyAttribute(name, value) {
        switch (name) {
            case "mode":
                this._core.mode = (value ?? "latest");
                break;
            case "naming":
                this._core.naming = (value ?? "manual");
                break;
            case "naming-limit":
                this._core.namingLimit = value === null ? Number.NaN : Number(value);
                break;
            case "reduced-motion":
                this._core.reducedMotion = (value ?? "skip");
                break;
            case "types":
                this._core.types = parseList(value);
                break;
            case "disabled":
                this._core.disabled = value !== null;
                break;
            case "for":
                this._core.participants = parseList(value);
                break;
        }
    }
}

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
function registerComponents(registry = customElements) {
    if (!registry.get(config.tagNames.viewTransition)) {
        registry.define(config.tagNames.viewTransition, WcsViewTransition);
    }
}

function bootstrapViewTransition(userConfig, registry) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents(registry);
}

export { TRANSITION_RUNNER_KEY, ViewTransitionCore, WcsViewTransition, bootstrapViewTransition, getConfig, getTransitionRunner, runTransition };
//# sourceMappingURL=index.esm.js.map

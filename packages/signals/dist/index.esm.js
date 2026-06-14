// Minimal signal core (PoC).
//
// A self-contained, zero-dependency reactive primitive whose public API is
// shaped after the TC39 Signals proposal (State / Computed / effect). The intent
// is NOT to ship signal-polyfill as a runtime dependency, but to keep an in-house
// implementation that can later be swapped for the native one without changing
// call sites. See docs/signals-state-design.md §2 (the "case C" decision).
//
// Reactivity model: three-color marking (CLEAN / CHECK / DIRTY), pull-validated
// (after Reactively / Solid). docs §8 (c).
//   - A signal write marks its direct observers DIRTY and their transitive
//     observers CHECK. Effects scheduled on the CLEAN→stale transition run on a
//     coalesced microtask (docs §5-3).
//   - On read/run, `updateIfNecessary` validates a CHECK node by refreshing its
//     computed sources first; it recomputes only if a source actually changed.
//   - EQUALITY SHORT-CIRCUIT: when a computed recomputes to an equal value it does
//     NOT mark its observers DIRTY, so downstream effects/computeds skip work.
//   - dependencies are re-tracked on every run, so conditional deps are pruned.
// Node freshness. CLEAN: up to date. CHECK: a transitive source may have changed
// — must validate before use. DIRTY: a direct source changed — must recompute.
// Typed as `number` (not literals) on purpose: `_state` is mutated through
// aliasing during `updateIfNecessary`, so literal narrowing would wrongly flag
// the `=== DIRTY` re-check after a source update.
const CLEAN = 0;
const CHECK = 1;
const DIRTY = 2;
// --- tracking context -------------------------------------------------------
let currentObserver = null;
function track(source) {
    if (currentObserver !== null) {
        currentObserver._sources.add(source);
        source._observers.add(currentObserver);
    }
}
function untrack(node) {
    for (const source of node._sources) {
        source._observers.delete(node);
    }
    node._sources.clear();
}
let currentOwner = null;
function registerDisposer(disposer) {
    if (currentOwner !== null) {
        currentOwner._owned.push(disposer);
    }
}
function disposeOwned(owner) {
    // Dispose in reverse creation order (children before parents, last-in-first-out).
    const owned = owner._owned;
    for (let i = owned.length - 1; i >= 0; i--) {
        owned[i]();
    }
    owned.length = 0;
}
// --- effect scheduling (microtask coalesce) ---------------------------------
const pendingEffects = new Set();
let flushScheduled = false;
function schedule() {
    if (flushScheduled) {
        return;
    }
    flushScheduled = true;
    queueMicrotask(flushEffects);
}
function flushEffects() {
    flushScheduled = false;
    // Drain in a loop: an effect may, while running, dirty a signal that queues
    // further effects. Coalescing collapses multiple writes in one tick into a
    // single run per effect (docs §5-3).
    while (pendingEffects.size > 0) {
        const batch = [...pendingEffects];
        pendingEffects.clear();
        for (const node of batch) {
            if (!node._disposed) {
                updateIfNecessary(node);
            }
        }
    }
}
/**
 * Synchronously flush queued effects. Provided for tests and for callers that
 * need DOM updates applied before reading the DOM back. In normal use effects
 * settle on their own microtask.
 */
function flushSync() {
    flushScheduled = false;
    flushEffects();
}
// --- marking & validation ---------------------------------------------------
function markStale(node, level) {
    if (node._state < level) {
        const wasClean = node._state === CLEAN;
        node._state = level;
        if (wasClean && node._isEffect) {
            pendingEffects.add(node);
            schedule();
        }
        // Observers can only become CHECK from us: they need to re-validate, but
        // whether they truly changed depends on our recomputed value.
        for (const observer of node._observers) {
            markStale(observer, CHECK);
        }
    }
}
function updateIfNecessary(node) {
    if (node._state === CLEAN) {
        return;
    }
    if (node._state === CHECK) {
        // A transitive source might have changed. Refresh computed sources; one of
        // them may set us DIRTY (via the equality check in its _update).
        for (const source of node._sources) {
            if (source instanceof ComputedNode) {
                updateIfNecessary(source);
                if (node._state === DIRTY) {
                    break;
                }
            }
        }
    }
    if (node._state === DIRTY) {
        node._update();
    }
    node._state = CLEAN;
}
// --- signal -----------------------------------------------------------------
class SignalNode {
    _observers = new Set();
    _value;
    _equals;
    constructor(value, equals) {
        this._value = value;
        this._equals = equals;
    }
    get() {
        track(this);
        return this._value;
    }
    peek() {
        return this._value;
    }
    set(next) {
        if (this._equals(this._value, next)) {
            return;
        }
        this._value = next;
        // Copy: markStale schedules effects but does not mutate this set; the copy is
        // defensive against future re-tracking during synchronous effect runs.
        for (const observer of [...this._observers]) {
            markStale(observer, DIRTY);
        }
    }
}
// --- computed ---------------------------------------------------------------
class ComputedNode {
    _observers = new Set();
    _sources = new Set();
    _state = DIRTY; // never computed yet
    _isEffect = false;
    _fn;
    _value = undefined;
    _initialized = false;
    _equals;
    constructor(fn, equals) {
        this._fn = fn;
        this._equals = equals;
    }
    get() {
        track(this);
        updateIfNecessary(this);
        return this._value;
    }
    peek() {
        updateIfNecessary(this);
        return this._value;
    }
    _update() {
        const previous = this._value;
        untrack(this);
        const prevObserver = currentObserver;
        currentObserver = this;
        try {
            this._value = this._fn();
        }
        finally {
            currentObserver = prevObserver;
        }
        // Equality short-circuit: only propagate when the value actually changed.
        // Our observers are already CHECK (from the originating markStale); promote
        // them to DIRTY so they recompute, otherwise leave them to settle CLEAN. Skip
        // on the first computation: there is no prior value to compare, and a custom
        // `equals` must not be invoked with the undefined sentinel.
        if (!this._initialized) {
            this._initialized = true;
        }
        else if (!this._equals(previous, this._value)) {
            for (const observer of this._observers) {
                observer._state = DIRTY;
            }
        }
    }
}
// --- effect -----------------------------------------------------------------
class EffectNode {
    _observers = new Set(); // effects are not observed; kept for the interface
    _sources = new Set();
    _owned = [];
    _state = DIRTY;
    _isEffect = true;
    _disposed = false;
    _fn;
    _cleanup = undefined;
    constructor(fn) {
        this._fn = fn;
        // Be owned by the enclosing owner (a parent effect or a createRoot), so a
        // parent teardown disposes this effect.
        registerDisposer(() => this.dispose());
        updateIfNecessary(this); // initial run (state starts DIRTY)
    }
    _update() {
        this._runCleanup();
        disposeOwned(this); // tear down children created in the previous run
        untrack(this);
        const prevObserver = currentObserver;
        const prevOwner = currentOwner;
        currentObserver = this;
        currentOwner = this; // children created during the run are owned by this effect
        try {
            this._cleanup = this._fn();
        }
        finally {
            currentObserver = prevObserver;
            currentOwner = prevOwner;
        }
    }
    _runCleanup() {
        if (typeof this._cleanup === "function") {
            this._cleanup();
            this._cleanup = undefined;
        }
    }
    dispose() {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._runCleanup();
        disposeOwned(this);
        untrack(this);
        pendingEffects.delete(this);
    }
}
// --- public API -------------------------------------------------------------
function signal(initial, equals = Object.is) {
    return new SignalNode(initial, equals);
}
function computed(fn, equals = Object.is) {
    return new ComputedNode(fn, equals);
}
function effect(fn) {
    return new EffectNode(fn);
}
/**
 * Run `fn` inside a fresh ownership scope and return its result. Every effect (or
 * nested cleanup) created during `fn` — directly or transitively — is owned by
 * this root; calling the `dispose` passed to `fn` tears them all down.
 *
 * The root is detached: it is NOT auto-disposed by an enclosing owner. The caller
 * holds `dispose` (e.g. a custom element disposes it in disconnectedCallback).
 */
function createRoot(fn) {
    const owner = { _owned: [] };
    let disposed = false;
    const dispose = () => {
        if (disposed) {
            return;
        }
        disposed = true;
        disposeOwned(owner);
    };
    const prevOwner = currentOwner;
    currentOwner = owner;
    try {
        return fn(dispose);
    }
    finally {
        currentOwner = prevOwner;
    }
}
/**
 * Register a teardown callback with the current owner. Runs when the owning effect
 * re-runs or is disposed, or when the enclosing root is disposed. A no-op when
 * there is no current owner.
 */
function onCleanup(fn) {
    registerDisposer(fn);
}

// Async resource (PoC).
//
// Adapts an async producer into a reactive `{ value, loading, error }` triad —
// the same shape FetchCore exposes (value/loading/error). When the resource's
// `args` (a reactive getter) change, the in-flight request is aborted and a fresh
// one starts: dependency-driven cancel/restart, i.e. RxJS switchMap.
//
// This is the signals-side counterpart of the state-side `$streams` adapter
// (docs/state-stream-type-design.md §4-1). The hard part — making sure a stale
// response from a superseded request never lands on the new state — is handled
// here by checking `signal.aborted` before committing any result.
function resource(source, options = {}) {
    const value = signal(options.initial);
    const loading = signal(false);
    const error = signal(null);
    let controller = null;
    const runner = effect(() => {
        // Reading args() inside the effect is what subscribes us to its signals, so a
        // change re-runs this body — that IS the restart trigger.
        const a = (options.args ? options.args() : undefined);
        // Abort the previous request before starting the next (switchMap).
        controller?.abort();
        const ac = new AbortController();
        controller = ac;
        loading.set(true);
        error.set(null);
        Promise.resolve(source(a, ac.signal)).then((resolved) => {
            // Drop the result if this request was superseded/disposed: committing it
            // would let a stale response overwrite the newer request's state.
            if (ac.signal.aborted) {
                return;
            }
            value.set(resolved);
            loading.set(false);
        }, (err) => {
            if (ac.signal.aborted) {
                return;
            }
            error.set(err);
            loading.set(false);
        });
    });
    const dispose = () => {
        controller?.abort();
        runner.dispose();
    };
    // Auto-dispose with the enclosing owner (createRoot / parent effect), so a
    // resource created inside a component is aborted on unmount. No-op when there
    // is no owner — the caller then disposes manually.
    onCleanup(dispose);
    return { value, loading, error, dispose };
}

// Stream resource (PoC §8 (a)). The signals-side counterpart of the state-side
// `$streams` adapter (docs/state-stream-type-design.md).
//
// Adapts a continuous async flow (async iterable / ReadableStream / async
// generator) into a single reactive value by FOLDING each chunk:
//   - latest (default): replace — value becomes the last chunk.
//   - reduce: accumulate — value = fold(acc, chunk), needs `initial`.
// When the resource's `args` change, the in-flight stream is aborted and a fresh
// one starts (switchMap), with `value` reset to `initial`.
//
// Deliberate non-goal: backpressure. The fold result IS the buffer; demand does
// not flow back to the producer. Unbounded accumulation of an infinite stream is
// a footgun — bound the fold (latest / count / last-N / window) for live streams.
// This mirrors the state `$streams` norm and is what lets the impedance mismatch
// be resolved honestly (state-stream §0, §4-3).
//
// Shared contract with state `$streams` (settled by this PoC):
//   - source(args, signal) receives an AbortSignal; honoring it drives restart.
//   - restart RESETS value to `initial`; error KEEPS the last value.
//   - status companion: "idle" | "active" | "done" | "error".
//   - async iterable is the lingua franca; a ReadableStream lacking
//     Symbol.asyncIterator is read via getReader().
function streamResource(source, options = {}) {
    const fold = options.fold ?? ((_acc, chunk) => chunk);
    const value = signal(options.initial);
    const status = signal("idle");
    const error = signal(null);
    let controller = null;
    const runner = effect(() => {
        const a = (options.args ? options.args() : undefined);
        controller?.abort();
        const ac = new AbortController();
        controller = ac;
        // Reset for the new run: a restart starts the fold from `initial`.
        value.set(options.initial);
        error.set(null);
        status.set("active");
        void consume(source, a, ac.signal, fold, value, status, error);
    });
    const dispose = () => {
        controller?.abort();
        runner.dispose();
    };
    onCleanup(dispose);
    return { value, status, error, dispose };
}
async function consume(source, args, signal, fold, value, status, error) {
    try {
        const produced = await source(args, signal);
        for await (const chunk of iterate(produced)) {
            if (signal.aborted) {
                return; // stale chunk from a superseded/disposed run — drop it
            }
            value.set(fold(value.peek(), chunk));
        }
        if (signal.aborted) {
            return; // stream ended but this run was aborted — don't mark done
        }
        status.set("done");
    }
    catch (e) {
        if (signal.aborted) {
            return; // an abort that surfaced as a throw is not an error
        }
        error.set(e); // keep the last folded value (do not reset)
        status.set("error");
    }
}
function iterate(produced) {
    if (typeof produced[Symbol.asyncIterator] === "function") {
        return produced;
    }
    return readableToAsyncIterable(produced);
}
async function* readableToAsyncIterable(stream) {
    const reader = stream.getReader();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                return;
            }
            yield value;
        }
    }
    finally {
        reader.releaseLock();
    }
}

// wc-bindable → signal adapter (PoC). The crux of the design.
//
// Any async-IO node in wcstack speaks the wc-bindable protocol: it exposes
//   - properties: outputs — the node dispatches `event` on change; the value is
//                 read via `getter(event)` or the property `name`.
//   - inputs:     settable surface — write `node[name] = value`.
//   - commands:   invocable methods — call `node[name](...args)`.
// The node has NO idea whether the observer behind the binding is a proxy (state)
// or a signal. So a single adapter that turns its `properties` into signals — and
// forwards inputs/commands — makes every existing node plug into the signal core
// unchanged. See docs/signals-state-design.md §3.
function readProperty(target, name) {
    return target[name];
}
function bindNode(target, descriptor) {
    const desc = descriptor ?? target.constructor.wcBindable;
    if (!desc) {
        throw new Error("bindNode: no wc-bindable descriptor provided and none found on target.constructor.wcBindable");
    }
    const signals = {};
    const removers = [];
    for (const prop of desc.properties) {
        // Seed with the node's current value so the signal is valid before the first
        // event fires (e.g. FetchCore.value === null at rest).
        const cell = signal(readProperty(target, prop.name));
        signals[prop.name] = cell;
        const handler = (event) => {
            cell.set(prop.getter ? prop.getter(event) : readProperty(target, prop.name));
        };
        target.addEventListener(prop.event, handler);
        removers.push(() => target.removeEventListener(prop.event, handler));
    }
    return {
        signals,
        set(name, value) {
            target[name] = value;
        },
        command(name, ...args) {
            return target[name](...args);
        },
        dispose() {
            for (const remove of removers) {
                remove();
            }
        },
    };
}

export { bindNode, computed, createRoot, effect, flushSync, onCleanup, resource, signal, streamResource };
//# sourceMappingURL=index.esm.js.map

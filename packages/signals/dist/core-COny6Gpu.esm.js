// Internal error-reporting policy (NOT part of the public API; not re-exported
// from exports.ts). Single source of truth for "surface an error without crashing".
//
// Delegates to the platform `reportError` when present — it dispatches a window
// "error" event / logs to the console without aborting the current task — and falls
// back to `console.error` otherwise. It NEVER re-throws (re-throwing would abort the
// caller's drain / abort handler) and NEVER swallows silently (that would hide bugs).
function reportError(err) {
    const r = globalThis.reportError;
    if (typeof r === "function") {
        r(err);
    }
    else {
        console.error(err);
    }
}

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
// Upper bound on drain iterations. A well-behaved graph settles in a handful of
// passes; exceeding this means an effect keeps dirtying its own dependency with a
// changing value (a reactive cycle), which would otherwise hang the page. We bail
// loudly instead of spinning forever (docs §5-3).
const MAX_FLUSH_ITERATIONS = 1000;
function flushEffects() {
    flushScheduled = false;
    // Drain in a loop: an effect may, while running, dirty a signal that queues
    // further effects. Coalescing collapses multiple writes in one tick into a
    // single run per effect (docs §5-3).
    let iterations = 0;
    while (pendingEffects.size > 0) {
        if (++iterations > MAX_FLUSH_ITERATIONS) {
            // Drop the runaway queue so a single bad effect cannot wedge every later
            // flush, then surface the bug.
            pendingEffects.clear();
            throw new Error("flushEffects: exceeded " +
                MAX_FLUSH_ITERATIONS +
                " iterations — likely a reactive cycle (an effect writes a signal it depends on with an ever-changing value).");
        }
        const batch = [...pendingEffects];
        pendingEffects.clear();
        for (const node of batch) {
            if (!node._disposed) {
                // Isolate each effect: a throw from one effect's body must NOT abort the
                // batch and silently strand its already-dequeued siblings. We hand the
                // error to reportError (which does not re-throw, so the drain continues)
                // and move on. updateIfNecessary guarantees the node is settled to CLEAN
                // even on throw, so it is not left stuck DIRTY.
                try {
                    updateIfNecessary(node);
                }
                catch (err) {
                    reportError(err);
                }
            }
        }
    }
}
// Effect/computed errors are surfaced via the shared `reportError` policy
// (./reportError.ts), called synchronously from the drain loop. It does NOT
// re-throw (that would abort the drain) and does NOT swallow (that would hide the
// bug). Re-entrancy is safe: the only re-scheduling path (markStale) defers to a
// microtask, so reporting here cannot recurse into the running flush.
/**
 * Synchronously flush queued effects. Provided for tests and for callers that
 * need DOM updates applied before reading the DOM back. In normal use effects
 * settle on their own microtask.
 */
function flushSync() {
    // Do NOT touch flushScheduled here: a microtask may already be queued. Just
    // drain. flushEffects resets the flag itself; if a queued microtask still fires
    // afterwards it finds an empty queue and is a no-op. Touching the flag from here
    // would let a second flushSync race the queued microtask into a double drain.
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
        // NOTE: this scans ALL sources each validation (O(sources)); the standard
        // pull-based scheme (Reactively/Solid) does the same. Intentional for the PoC —
        // a future optimization could track per-source dirtiness to scan less.
        for (const source of node._sources) {
            if (source instanceof ComputedNode) {
                updateIfNecessary(source);
                if (node._state === DIRTY) {
                    break;
                }
            }
        }
    }
    // Settle to CLEAN in a finally: if _update() (a user fn / equals) throws, the
    // node must NOT be left stuck DIRTY, otherwise every later peek/get would
    // re-run the throwing fn forever. The error propagates to the caller (a flush
    // isolates it per-effect; a direct get/peek surfaces it to that caller).
    try {
        if (node._state === DIRTY) {
            node._update();
        }
    }
    finally {
        node._state = CLEAN;
    }
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
        // No copy needed: markStale only schedules effects (on a microtask) and marks
        // observers — it never runs user code synchronously, so this set is not
        // mutated during the walk. Iterating it directly avoids a per-write allocation.
        for (const observer of this._observers) {
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
    _running = false;
    _equals;
    constructor(fn, equals) {
        this._fn = fn;
        this._equals = equals;
        // Be owned by the enclosing scope (a parent effect or createRoot). When that
        // scope tears down, untrack this computed so it is removed from its sources'
        // observer sets — otherwise a computed created inside an effect that re-runs
        // would leak a stale ComputedNode into each source on every run (docs §8 (d)).
        // Lazy + no children: teardown is just untrack, no cleanup/owned to dispose.
        registerDisposer(() => untrack(this));
    }
    get() {
        // Order matters: track BEFORE updateIfNecessary. The current observer must be
        // registered against THIS computed regardless of whether validation recomputes —
        // and recomputation swaps currentObserver to this node, so tracking first records
        // the edge under the OUTER observer (the caller), not this computed's own run.
        track(this);
        updateIfNecessary(this);
        return this._value;
    }
    peek() {
        updateIfNecessary(this);
        return this._value;
    }
    _update() {
        // Cycle guard: if _fn (directly or transitively) reads this computed, get()
        // would recurse into _update and blow the stack with an opaque RangeError.
        // Detect the self-reference and throw a clear error instead. (The effect-level
        // MAX_FLUSH_ITERATIONS guard does not cover this synchronous self-recursion.)
        if (this._running) {
            throw new Error("computed: circular dependency — the computed reads itself.");
        }
        const previous = this._value;
        untrack(this);
        const prevObserver = currentObserver;
        currentObserver = this;
        this._running = true;
        try {
            this._value = this._fn();
        }
        finally {
            this._running = false;
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
                // Normally this computed is refreshed from inside flushEffects while
                // validating an already-scheduled effect, so the observer is in the queue
                // already. But if it is refreshed out-of-band (e.g. a `peek()` outside a
                // flush) an effect observer could otherwise be promoted to DIRTY without
                // being queued, and never re-run. Re-schedule defensively to keep the
                // "DIRTY effect always runs" invariant regardless of refresh path.
                if (observer._isEffect && !observer._disposed) {
                    pendingEffects.add(observer);
                    schedule();
                }
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
 *
 * If `fn` throws, any effects/cleanups it created BEFORE the throw are disposed
 * before the error propagates — a caller that never received `dispose` (because the
 * call threw) cannot leak the half-built scope.
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
    const prevObserver = currentObserver;
    currentOwner = owner;
    // Detach the dependency-tracking context too, not just ownership. A root is a
    // fresh reactive boundary: signals read SYNCHRONOUSLY while `fn` builds the scope
    // must not register the OUTER observer as their dependent (Solid's createRoot
    // clears both owner and listener). Without this, a For/Index `each` that reads
    // `index()`/`item()` synchronously in its body would track the outer reconcile
    // effect against the row's idx/item signal, so reordering re-dirties the reconcile
    // effect — a self-loop the equality/MAX_FLUSH guards only paper over.
    currentObserver = null;
    try {
        return fn(dispose);
    }
    catch (err) {
        dispose(); // tear down whatever fn built before it threw
        throw err;
    }
    finally {
        currentOwner = prevOwner;
        currentObserver = prevObserver;
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
        //
        // NOTE (effect-internal writes): this effect writes loading/error/value, which
        // are signals OTHER effects may observe. A write that actually CHANGES the value
        // marks those observers stale and queues them on the same flush; the drain loop
        // then runs them in the same tick. (A same-value write — e.g. error.set(null)
        // when error is already null — is a no-op via the equality guard and notifies
        // nothing.) We never read these signals inside THIS effect, so we don't dirty
        // our own dependency — no cycle. (docs §8 (a)).
        const a = (options.args ? options.args() : undefined);
        // Abort the previous request before starting the next (switchMap).
        controller?.abort();
        const ac = new AbortController();
        controller = ac;
        loading.set(true);
        error.set(null);
        // Call the source SYNCHRONOUSLY (so it receives ac.signal immediately and can
        // wire its abort listener before any teardown), but guard it with try/catch so
        // a synchronous throw is normalized into the same error/loading state as a
        // rejected promise. Without the guard a sync throw would escape the effect body
        // (and, on the initial run, the resource() call itself), leaving loading stuck
        // true and error unset.
        let produced;
        try {
            produced = source(a, ac.signal);
        }
        catch (err) {
            error.set(err);
            loading.set(false);
            return;
        }
        Promise.resolve(produced).then((resolved) => {
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
//
// CAVEAT (cooperative cancellation): for a ReadableStream we force-unwind a parked
// read() on abort via reader.cancel(). A plain AsyncIterable / async generator has
// no such hook — if it ignores `signal` and parks (awaiting before the next yield),
// the for-await never resolves, so the consume() task and any resource it holds stay
// alive past restart/dispose. The `if (signal.aborted) return` check only runs after
// a chunk arrives, not while parked. Bound by honoring `signal` in the source.
function streamResource(source, options = {}) {
    const fold = options.fold ?? ((_acc, chunk) => chunk);
    const value = signal(options.initial);
    const status = signal("idle");
    const error = signal(null);
    let controller = null;
    const runner = effect(() => {
        // NOTE (effect-internal writes): like `resource`, this effect writes
        // value/status/error — signals other effects may observe. Those observers are
        // queued on the same flush and run in the same tick. This effect never reads
        // those signals, so it does not dirty its own dependency (no cycle). The async
        // `consume` writes them later from microtasks/timers, outside this flush.
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
async function consume(source, args, signal, fold, 
// Use the public WriteSignal type instead of re-declaring an inline subset, so
// these stay in lockstep with the signal API (no structural drift).
value, status, error) {
    try {
        const produced = await source(args, signal);
        for await (const chunk of iterate(produced, signal)) {
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
function iterate(produced, signal) {
    if (typeof produced[Symbol.asyncIterator] === "function") {
        return produced;
    }
    // Not async-iterable: must be a ReadableStream (read via getReader). Validate so
    // a wrong source value yields a clear error instead of an opaque "getReader is
    // not a function" from inside the generator.
    if (typeof produced?.getReader !== "function") {
        throw new TypeError("streamResource: source must return an AsyncIterable or a ReadableStream (got neither).");
    }
    return readableToAsyncIterable(produced, signal);
}
async function* readableToAsyncIterable(stream, signal) {
    const reader = stream.getReader();
    // A ReadableStream read() does NOT observe an AbortSignal on its own. Without
    // this, a switchMap restart / dispose leaves the previous reader parked in a
    // pending read() forever, leaking the underlying source. Cancelling on abort
    // both releases the source AND settles the pending read() so the for-await
    // unwinds and the finally below can release the lock. Abort is the only
    // early-exit path for this generator (the consumer never calls .return()
    // without aborting), so this is the sole place a non-drained stream is cancelled.
    const onAbort = () => {
        void reader.cancel().catch(() => { }); // tearing down; swallow a rejected cancel
    };
    signal.addEventListener("abort", onAbort, { once: true });
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
        signal.removeEventListener("abort", onAbort);
        reader.releaseLock();
    }
}

// wc-bindable → signal adapter. The crux of the design.
//
// Any async-IO node in wcstack speaks the wc-bindable protocol:
//   - properties: outputs — the node dispatches `event` on change; the value is
//                 read via `getter(event)` or the property `name`.
//   - inputs:     settable surface — write `node[name] = value`.
//   - commands:   invocable methods — call `node[name](...args)`.
// The node has NO idea whether the observer behind the binding is a proxy (state)
// or a signal. So a single adapter that maps these surfaces onto signals makes every
// existing node plug into the signal core unchanged. See docs/signals-state-design.md
// §3, and the four mappings of §3-1:
//
//   element → signal | property (latest snapshot)   → read signal      [`signals`]
//   element → signal | event-token (per-emit stream) → folded signal   [`on`]
//   signal → element | input (write-back)            → effect → prop    [`bindInput`]
//   signal → element | command-token (start/cancel)  → emit on change   [`bindCommand`]
//
// `signals` is the STATE view of a property (equality-guarded — same value = no
// update). `on` is the OCCURRENCE view of the same event (a stream — every emit
// updates, even with an equal value), folded latest-by-default.
// Internal (NOT exported): the error thrown by `assertLive` when a method is called
// after dispose. Carries a brand symbol so callers that need to distinguish a
// post-dispose throw (e.g. nodeSource's abort bridge) can test it structurally
// instead of matching the message string — the message is free to change without
// silently breaking the guard. The brand survives even if a consumer's bundler
// duplicates the class (e.g. `instanceof` across realms), since it's a Symbol on
// the instance, not a class identity check.
const DISPOSED_ERROR = Symbol("bindNode.disposed");
class DisposedError extends Error {
    [DISPOSED_ERROR] = true;
}
/** True if `err` was thrown by `assertLive` (a use-after-dispose error). */
function isDisposedError(err) {
    return typeof err === "object" && err !== null && err[DISPOSED_ERROR] === true;
}
function readProperty(target, name) {
    return target[name];
}
function bindNode(target, descriptor) {
    const desc = descriptor ?? target.constructor.wcBindable;
    if (!desc) {
        throw new Error("bindNode: no wc-bindable descriptor provided and none found on target.constructor.wcBindable");
    }
    // Name → declared-entry lookups so set/command/on reject names the node never
    // declared, instead of silently writing/invoking/listening on an arbitrary member.
    const propByName = new Map(desc.properties.map((p) => [p.name, p]));
    const declaredInputs = new Set((desc.inputs ?? []).map((i) => i.name));
    const declaredCommands = new Set((desc.commands ?? []).map((c) => c.name));
    const signals = {};
    const removers = [];
    let disposed = false;
    const assertLive = (op, name) => {
        if (disposed) {
            throw new DisposedError(`bindNode.${op}: "${name}" called after dispose (the adapter is inert).`);
        }
    };
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
        // Re-seed AFTER subscribing: the initial read above is a snapshot taken before
        // the listener was attached, so a value change in that gap would be missed.
        // Reading the property once more now closes the race (the equality guard makes
        // it a no-op when nothing changed). Note this is the property snapshot, not a
        // getter(event) — there is no event to derive from at bind time.
        cell.set(readProperty(target, prop.name));
    }
    return {
        signals,
        on(prop, options = {}) {
            assertLive("on", prop);
            const propDesc = propByName.get(prop);
            if (!propDesc) {
                throw new Error(`bindNode.on: "${prop}" is not a declared property on this node.`);
            }
            const fold = options.fold ?? ((_acc, chunk) => chunk);
            // equals: () => false — a stream notifies on EVERY emit, even an equal value.
            const cell = signal(options.initial, () => false);
            const handler = (event) => {
                const chunk = (propDesc.getter ? propDesc.getter(event) : readProperty(target, prop));
                cell.set(fold(cell.peek(), chunk));
            };
            target.addEventListener(propDesc.event, handler);
            removers.push(() => target.removeEventListener(propDesc.event, handler));
            return cell;
        },
        set(name, value) {
            assertLive("set", name);
            if (!declaredInputs.has(name)) {
                throw new Error(`bindNode.set: "${name}" is not a declared input on this node.`);
            }
            target[name] = value;
        },
        bindInput(name, source) {
            assertLive("bindInput", name);
            if (!declaredInputs.has(name)) {
                throw new Error(`bindNode.bindInput: "${name}" is not a declared input on this node.`);
            }
            const handle = effect(() => {
                const v = source.get();
                if (target[name] !== v) {
                    target[name] = v; // same-value guard above breaks write→event→write loops
                }
            });
            removers.push(() => handle.dispose());
            return () => handle.dispose();
        },
        command(name, ...args) {
            assertLive("command", name);
            if (!declaredCommands.has(name)) {
                throw new Error(`bindNode.command: "${name}" is not a declared command on this node.`);
            }
            if (typeof target[name] !== "function") {
                throw new TypeError(`bindNode.command: "${name}" is declared but not a function on the node.`);
            }
            return target[name](...args);
        },
        bindCommand(name, trigger, mapArgs) {
            assertLive("bindCommand", name);
            if (!declaredCommands.has(name)) {
                throw new Error(`bindNode.bindCommand: "${name}" is not a declared command on this node.`);
            }
            // Fail fast at bind time (not on first change), so a wrong name surfaces when
            // the subscription is set up rather than silently later inside a flush.
            if (typeof target[name] !== "function") {
                throw new TypeError(`bindNode.bindCommand: "${name}" is declared but not a function on the node.`);
            }
            let primed = false;
            const handle = effect(() => {
                const v = trigger.get();
                if (!primed) {
                    primed = true; // subscribe on mount without firing (emit on CHANGE only)
                    return;
                }
                const args = mapArgs ? mapArgs(v) : [v];
                target[name](...args);
            });
            removers.push(() => handle.dispose());
            return () => handle.dispose();
        },
        dispose() {
            if (disposed) {
                return; // idempotent
            }
            disposed = true;
            for (const remove of removers) {
                remove();
            }
        },
    };
}
/**
 * Build a `resource` source from a wc-bindable node, bridging the resource's
 * AbortSignal to the node's cancel command (default `"abort"`) before delegating to
 * `run`. This generalizes the PoC's hand-wired `sig → core.abort()` bridge (docs §8
 * (e), §5-2): wrap the result in `resource({ args })` and any node that declares an
 * abort command gets switchMap-style cancel/restart for free — an `args` change
 * aborts the in-flight call (firing the node's abort command, which cancels its real
 * AbortController) and starts the next.
 *
 * The node's own value/loading/error stay available via `bound.signals`; `resource`
 * here is used for the cancel/restart lifecycle, not to re-derive that triad.
 *
 * @example
 *   const bound = bindNode(fetchEl);
 *   const r = resource(
 *     nodeSource(bound, (b, id) => b.command("fetch", `/api/${id}`)),
 *     { args: () => id.get() },
 *   );
 */
function nodeSource(bound, run, options = {}) {
    const abortName = options.abort ?? "abort";
    return (args, signal) => {
        // Honor the resource's cancel by invoking the node's abort command. `once`:
        // each resource run gets a fresh AbortSignal, so the listener fires at most once.
        //
        // GUARD: the abort listener runs SYNCHRONOUSLY inside AbortController.abort().
        // If `bound` was already disposed (e.g. the adapter and the resource share an
        // owner and the adapter's disposer ran first), `command` throws assertLive —
        // and a throw out of an abort listener surfaces as an unhandled exception during
        // the synchronous abort() call. Swallow a post-dispose throw so teardown order is
        // robust; report any OTHER error via the platform reporter without breaking abort.
        signal.addEventListener("abort", () => {
            try {
                bound.command(abortName);
            }
            catch (err) {
                // Brand-based check (not a message regex): a post-dispose throw is
                // expected here and swallowed; any OTHER error is reported.
                if (!isDisposedError(err)) {
                    reportError(err);
                }
            }
        }, { once: true });
        return run(bound, args);
    };
}

export { createRoot as a, bindNode as b, computed as c, streamResource as d, effect as e, flushSync as f, nodeSource as n, onCleanup as o, resource as r, signal as s };
//# sourceMappingURL=core-COny6Gpu.esm.js.map

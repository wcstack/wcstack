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

export type Cleanup = () => void;
export type Equals<T> = (a: T, b: T) => boolean;

export interface ReadSignal<T> {
  /** Read the value AND register the current observer as a dependent. */
  get(): T;
  /** Read the value WITHOUT tracking (no dependency edge created). */
  peek(): T;
}

export interface WriteSignal<T> extends ReadSignal<T> {
  set(value: T): void;
}

export interface EffectHandle {
  dispose(): void;
}

// Node freshness. CLEAN: up to date. CHECK: a transitive source may have changed
// — must validate before use. DIRTY: a direct source changed — must recompute.
// Typed as `number` (not literals) on purpose: `_state` is mutated through
// aliasing during `updateIfNecessary`, so literal narrowing would wrongly flag
// the `=== DIRTY` re-check after a source update.
const CLEAN: number = 0;
const CHECK: number = 1;
const DIRTY: number = 2;

interface Observable {
  _observers: Set<Computation>;
}

interface Computation extends Observable {
  _state: number;
  _sources: Set<Observable>;
  _isEffect: boolean;
  _update(): void;
}

// --- tracking context -------------------------------------------------------

let currentObserver: Computation | null = null;

function track(source: Observable): void {
  if (currentObserver !== null) {
    currentObserver._sources.add(source);
    source._observers.add(currentObserver);
  }
}

function untrack(node: Computation): void {
  for (const source of node._sources) {
    source._observers.delete(node);
  }
  node._sources.clear();
}

// --- ownership (disposal tree) ----------------------------------------------
//
// Orthogonal to dependency tracking. An "owner" collects the disposers of the
// computations (effects, nested cleanups, child roots) created during its run.
// An effect IS an owner: it owns whatever was created while it ran, and disposes
// those children before it re-runs or is disposed. This is what lets the DOM
// layer rebuild a subtree without leaking the previous subtree's effects
// (docs §8 (d)). Modeled after Solid's reactive ownership.

type Disposer = () => void;

interface Owner {
  _owned: Disposer[];
}

let currentOwner: Owner | null = null;

function registerDisposer(disposer: Disposer): void {
  if (currentOwner !== null) {
    currentOwner._owned.push(disposer);
  }
}

function disposeOwned(owner: Owner): void {
  // Dispose in reverse creation order (children before parents, last-in-first-out).
  const owned = owner._owned;
  for (let i = owned.length - 1; i >= 0; i--) {
    owned[i]();
  }
  owned.length = 0;
}

// --- effect scheduling (microtask coalesce) ---------------------------------

const pendingEffects = new Set<EffectNode>();
let flushScheduled = false;

function schedule(): void {
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

function flushEffects(): void {
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
      throw new Error(
        "flushEffects: exceeded " +
          MAX_FLUSH_ITERATIONS +
          " iterations — likely a reactive cycle (an effect writes a signal it depends on with an ever-changing value).",
      );
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
        } catch (err) {
          reportError(err);
        }
      }
    }
  }
}

// Surface an effect/computed error without breaking the flush. Called
// synchronously from the drain loop: it delegates to the platform `reportError`
// (dispatches a window "error" event / goes to the console without crashing) or
// falls back to console.error. Crucially it does NOT re-throw — re-throwing would
// abort the drain — and it does not swallow the error (that would hide the bug).
// Re-entrancy is safe: the only re-scheduling path (markStale) defers to a
// microtask, so reporting here cannot recurse into the running flush.
function reportError(err: unknown): void {
  const r = (globalThis as { reportError?: (e: unknown) => void }).reportError;
  if (typeof r === "function") {
    r(err);
  } else {
    console.error(err);
  }
}

/**
 * Synchronously flush queued effects. Provided for tests and for callers that
 * need DOM updates applied before reading the DOM back. In normal use effects
 * settle on their own microtask.
 */
export function flushSync(): void {
  // Do NOT touch flushScheduled here: a microtask may already be queued. Just
  // drain. flushEffects resets the flag itself; if a queued microtask still fires
  // afterwards it finds an empty queue and is a no-op. Touching the flag from here
  // would let a second flushSync race the queued microtask into a double drain.
  flushEffects();
}

// --- marking & validation ---------------------------------------------------

function markStale(node: Computation, level: number): void {
  if (node._state < level) {
    const wasClean = node._state === CLEAN;
    node._state = level;
    if (wasClean && node._isEffect) {
      pendingEffects.add(node as EffectNode);
      schedule();
    }
    // Observers can only become CHECK from us: they need to re-validate, but
    // whether they truly changed depends on our recomputed value.
    for (const observer of node._observers) {
      markStale(observer, CHECK);
    }
  }
}

function updateIfNecessary(node: Computation): void {
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
  } finally {
    node._state = CLEAN;
  }
}

// --- signal -----------------------------------------------------------------

class SignalNode<T> implements Observable, WriteSignal<T> {
  _observers = new Set<Computation>();
  private _value: T;
  private _equals: Equals<T>;

  constructor(value: T, equals: Equals<T>) {
    this._value = value;
    this._equals = equals;
  }

  get(): T {
    track(this);
    return this._value;
  }

  peek(): T {
    return this._value;
  }

  set(next: T): void {
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

class ComputedNode<T> implements Computation, ReadSignal<T> {
  _observers = new Set<Computation>();
  _sources = new Set<Observable>();
  _state = DIRTY; // never computed yet
  _isEffect = false;
  private _fn: () => T;
  private _value: T | undefined = undefined;
  private _initialized = false;
  private _running = false;
  private _equals: Equals<T>;

  constructor(fn: () => T, equals: Equals<T>) {
    this._fn = fn;
    this._equals = equals;
    // Be owned by the enclosing scope (a parent effect or createRoot). When that
    // scope tears down, untrack this computed so it is removed from its sources'
    // observer sets — otherwise a computed created inside an effect that re-runs
    // would leak a stale ComputedNode into each source on every run (docs §8 (d)).
    // Lazy + no children: teardown is just untrack, no cleanup/owned to dispose.
    registerDisposer(() => untrack(this));
  }

  get(): T {
    track(this);
    updateIfNecessary(this);
    return this._value as T;
  }

  peek(): T {
    updateIfNecessary(this);
    return this._value as T;
  }

  _update(): void {
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
    } finally {
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
    } else if (!this._equals(previous as T, this._value as T)) {
      for (const observer of this._observers) {
        observer._state = DIRTY;
        // Normally this computed is refreshed from inside flushEffects while
        // validating an already-scheduled effect, so the observer is in the queue
        // already. But if it is refreshed out-of-band (e.g. a `peek()` outside a
        // flush) an effect observer could otherwise be promoted to DIRTY without
        // being queued, and never re-run. Re-schedule defensively to keep the
        // "DIRTY effect always runs" invariant regardless of refresh path.
        if (observer._isEffect && !(observer as EffectNode)._disposed) {
          pendingEffects.add(observer as EffectNode);
          schedule();
        }
      }
    }
  }
}

// --- effect -----------------------------------------------------------------

class EffectNode implements Computation, Owner {
  _observers = new Set<Computation>(); // effects are not observed; kept for the interface
  _sources = new Set<Observable>();
  _owned: Disposer[] = [];
  _state = DIRTY;
  _isEffect = true;
  _disposed = false;
  private _fn: () => Cleanup | void;
  private _cleanup: Cleanup | void = undefined;

  constructor(fn: () => Cleanup | void) {
    this._fn = fn;
    // Be owned by the enclosing owner (a parent effect or a createRoot), so a
    // parent teardown disposes this effect.
    registerDisposer(() => this.dispose());
    updateIfNecessary(this); // initial run (state starts DIRTY)
  }

  _update(): void {
    this._runCleanup();
    disposeOwned(this); // tear down children created in the previous run
    untrack(this);
    const prevObserver = currentObserver;
    const prevOwner = currentOwner;
    currentObserver = this;
    currentOwner = this; // children created during the run are owned by this effect
    try {
      this._cleanup = this._fn();
    } finally {
      currentObserver = prevObserver;
      currentOwner = prevOwner;
    }
  }

  private _runCleanup(): void {
    if (typeof this._cleanup === "function") {
      this._cleanup();
      this._cleanup = undefined;
    }
  }

  dispose(): void {
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

export function signal<T>(initial: T, equals: Equals<T> = Object.is): WriteSignal<T> {
  return new SignalNode(initial, equals);
}

export function computed<T>(fn: () => T, equals: Equals<T> = Object.is): ReadSignal<T> {
  return new ComputedNode(fn, equals);
}

export function effect(fn: () => Cleanup | void): EffectHandle {
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
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  const owner: Owner = { _owned: [] };
  let disposed = false;
  const dispose = (): void => {
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
  } catch (err) {
    dispose(); // tear down whatever fn built before it threw
    throw err;
  } finally {
    currentOwner = prevOwner;
  }
}

/**
 * Register a teardown callback with the current owner. Runs when the owning effect
 * re-runs or is disposed, or when the enclosing root is disposed. A no-op when
 * there is no current owner.
 */
export function onCleanup(fn: () => void): void {
  registerDisposer(fn);
}

// Test-only helpers.
//
// 1. ElementInternals / CustomStateSet shim — happy-dom does not implement it
//    (docs/custom-state-reflection-design.md §3.6). Installed exactly once from
//    setup.ts, and only when the real API is absent.
// 2. FakeScheduler — the injectable RafScheduler for Core tests. The dt
//    contract is timestamp-derived, so tests must pump frames with EXPLICIT
//    timestamps; relying on happy-dom's own requestAnimationFrame would make
//    dt assertions timing-dependent.
// 3. installGlobalRafMock — swaps globalThis.requestAnimationFrame /
//    cancelAnimationFrame for a FakeScheduler-backed pair, for Shell tests
//    (the Shell constructs its own Core with no injection hook) and for
//    exercising the call-time resolution path (§3.7).
// 4. setVisibility — overrides document.visibilityState and dispatches
//    visibilitychange, driving the `suspended` output.

interface FakeElementInternals {
  states: Set<string>;
}

const internalsByElement = new WeakMap<HTMLElement, FakeElementInternals>();

export function installElementInternalsShim(): void {
  if (typeof HTMLElement.prototype.attachInternals === "function") {
    return;
  }

  HTMLElement.prototype.attachInternals = function (this: HTMLElement): ElementInternals {
    if (internalsByElement.has(this)) {
      throw new DOMException(
        "attachInternals() has already been called on this element.",
        "NotSupportedError",
      );
    }
    const fake: FakeElementInternals = { states: new Set<string>() };
    internalsByElement.set(this, fake);
    return fake as unknown as ElementInternals;
  };
}

// Test inspection helper: reads back the CustomStateSet-equivalent for an
// element that went through the shimmed attachInternals(). Returns undefined
// if the element never called attachInternals() (e.g. _internals is null).
export function getStates(el: HTMLElement): Set<string> | undefined {
  return internalsByElement.get(el)?.states;
}

// --- FakeScheduler -----------------------------------------------------------

export interface FakeSchedulerOptions {
  // When true, cancel() is ignored — the queued callback survives. Used to
  // simulate a frame already in flight when dispose() runs, exercising the
  // `_gen` stale-run guard (the handle was cancelled but the callback fires
  // anyway, as can happen when the callback was already dequeued).
  ignoreCancel?: boolean;
}

export class FakeScheduler {
  private _pending = new Map<number, (ts: number) => void>();
  private _seq = 0;
  private _ignoreCancel: boolean;

  constructor(options: FakeSchedulerOptions = {}) {
    this._ignoreCancel = options.ignoreCancel === true;
  }

  // Arrow properties so the instance can be passed directly as a RafScheduler.
  request = (callback: (ts: number) => void): unknown => {
    const handle = ++this._seq;
    this._pending.set(handle, callback);
    return handle;
  };

  cancel = (handle: unknown): void => {
    if (this._ignoreCancel) return;
    this._pending.delete(handle as number);
  };

  get pending(): number {
    return this._pending.size;
  }

  // Deliver one frame to every queued callback with the given timestamp.
  // Callbacks re-requesting during the pump land in the NEXT frame's queue
  // (matching real rAF semantics: a request from inside a frame callback is
  // scheduled for the following frame).
  pump(timestamp: number): void {
    const callbacks = [...this._pending.values()];
    this._pending.clear();
    for (const callback of callbacks) {
      callback(timestamp);
    }
  }
}

// --- Global rAF mock ---------------------------------------------------------

interface GlobalRafSnapshot {
  raf: unknown;
  caf: unknown;
}

export function installGlobalRafMock(scheduler: FakeScheduler): () => void {
  const g = globalThis as Record<string, unknown>;
  const snapshot: GlobalRafSnapshot = {
    raf: g.requestAnimationFrame,
    caf: g.cancelAnimationFrame,
  };
  g.requestAnimationFrame = scheduler.request;
  g.cancelAnimationFrame = scheduler.cancel;
  return () => {
    restoreGlobal("requestAnimationFrame", snapshot.raf);
    restoreGlobal("cancelAnimationFrame", snapshot.caf);
  };
}

// Remove rAF from the global entirely (the "platform without rAF" case —
// never-throw / silent no-op path). Returns a restore function.
export function removeGlobalRaf(): () => void {
  const g = globalThis as Record<string, unknown>;
  const snapshot: GlobalRafSnapshot = {
    raf: g.requestAnimationFrame,
    caf: g.cancelAnimationFrame,
  };
  delete g.requestAnimationFrame;
  delete g.cancelAnimationFrame;
  return () => {
    restoreGlobal("requestAnimationFrame", snapshot.raf);
    restoreGlobal("cancelAnimationFrame", snapshot.caf);
  };
}

function restoreGlobal(key: string, value: unknown): void {
  const g = globalThis as Record<string, unknown>;
  if (value === undefined) {
    delete g[key];
  } else {
    g[key] = value;
  }
}

// --- Visibility mock ---------------------------------------------------------

// Overrides document.visibilityState (configurable so repeated calls and the
// final reset work) and fires visibilitychange.
export function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

export function resetVisibility(): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
}

import { vi } from "vitest";

/**
 * Controllable fakes for the Screen Wake Lock API and document visibility, which
 * happy-dom does not provide. A test installs `installWakeLock()` (and, when it
 * exercises the auto-release / re-acquire path, `installVisibility()`), drives the
 * lock via `autoRelease()` / `setVisibility()`, and restores in afterEach.
 */

export class FakeWakeLockSentinel extends EventTarget {
  released = false;
  type: string;
  private _rejectRelease: boolean;
  // Spy so tests can assert release() was called (e.g. on supersession). When
  // `rejectRelease` is set the returned promise rejects, exercising the Core's
  // never-throw `.catch()` on release().
  release = vi.fn((): Promise<void> => {
    this._fire();
    return this._rejectRelease ? Promise.reject(new Error("release failed")) : Promise.resolve();
  });

  constructor(type: string, rejectRelease = false) {
    super();
    this.type = type;
    this._rejectRelease = rejectRelease;
  }

  /** Simulate the OS auto-releasing this lock (tab hidden / minimized). */
  autoRelease(): void {
    this._fire();
  }

  private _fire(): void {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event("release"));
  }
}

interface Deferred {
  resolve: (s: FakeWakeLockSentinel) => void;
  reject: (e: unknown) => void;
  sentinel: FakeWakeLockSentinel;
}

export interface WakeLockControl {
  request: ReturnType<typeof vi.fn>;
  sentinels: FakeWakeLockSentinel[];
  last(): FakeWakeLockSentinel | undefined;
  /** Resolve the oldest pending deferred request (deferred mode only). */
  resolveNext(): void;
  /** Reject the oldest pending deferred request (deferred mode only). */
  rejectNext(error: unknown): void;
  restore(): void;
}

export function installWakeLock(
  opts: {
    reject?: unknown;
    rejectFactory?: () => unknown; // fresh value per call (real APIs reject anew each time)
    deferred?: boolean;
    rejectRelease?: boolean;
  } = {}
): WakeLockControl {
  const sentinels: FakeWakeLockSentinel[] = [];
  const pending: Deferred[] = [];

  // opts precedence (first match wins):
  //   1. rejectFactory — reject with a fresh value per call (real APIs reject anew).
  //   2. reject        — reject with the same fixed value every call.
  //   3. deferred      — resolve manually via resolveNext()/rejectNext().
  //   4. (default)     — resolve immediately with a new sentinel.
  // rejectRelease is orthogonal: it only affects sentinels actually created (cases
  // 3 and 4), making their release() reject so the Core's never-throw catch is hit.
  const request = vi.fn((type: string): Promise<FakeWakeLockSentinel> => {
    if (opts.rejectFactory) {
      return Promise.reject(opts.rejectFactory());
    }
    if (opts.reject !== undefined) {
      return Promise.reject(opts.reject);
    }
    const sentinel = new FakeWakeLockSentinel(type, opts.rejectRelease);
    if (opts.deferred) {
      return new Promise<FakeWakeLockSentinel>((resolve, reject) => {
        pending.push({ resolve, reject, sentinel });
      });
    }
    sentinels.push(sentinel);
    return Promise.resolve(sentinel);
  });

  const prev = (navigator as any).wakeLock;
  (navigator as any).wakeLock = { request };

  return {
    request,
    sentinels,
    last: () => sentinels[sentinels.length - 1],
    resolveNext: () => {
      const d = pending.shift();
      if (d) {
        sentinels.push(d.sentinel);
        d.resolve(d.sentinel);
      }
    },
    rejectNext: (error: unknown) => {
      const d = pending.shift();
      if (d) d.reject(error);
    },
    restore: () => {
      (navigator as any).wakeLock = prev;
    },
  };
}

/** Remove navigator.wakeLock entirely (unsupported-environment simulation). */
export function uninstallWakeLock(): void {
  (navigator as any).wakeLock = undefined;
}

let _visibility: DocumentVisibilityState = "visible";

/** Override document.visibilityState with a controllable value. Returns teardown. */
export function installVisibility(initial: DocumentVisibilityState = "visible"): () => void {
  _visibility = initial;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => _visibility,
  });
  return () => {
    delete (document as any).visibilityState;
  };
}

/** Set the visibility and dispatch a visibilitychange event. */
export function setVisibility(state: DocumentVisibilityState): void {
  _visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

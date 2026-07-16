import { IWcBindable, WakeLockKind } from "../types.js";
import { WcsIoErrorInfo } from "./platformCapability.js";
import { deriveWakeLockErrorInfo } from "./wakelockCapabilities.js";

/**
 * Minimal structural views of the Screen Wake Lock API. Declared locally (rather
 * than relying on `lib.dom`'s experimental `WakeLock` types) so the package type-
 * checks the same across TypeScript lib versions, and so a runtime where
 * `navigator.wakeLock` is absent is just a value check, never a type error.
 */
interface WakeLockSentinelLike extends EventTarget {
  readonly released: boolean;
  readonly type: string;
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type?: string): Promise<WakeLockSentinelLike>;
}

/**
 * Headless screen-wake-lock primitive — a thin, framework-agnostic wrapper around
 * the Screen Wake Lock API exposed through the wc-bindable protocol.
 *
 * Unlike the other @wcstack sensors (geolocation / intersection), the wake lock is
 * a pure *sink*: nothing is read from the device. A bound state drives the desired
 * intent (`request()` / `release()`), and the only observable outputs are `held`
 * (whether a sentinel is actually held) and `error`.
 *
 * The OS releases the lock whenever the page stops being visible (tab hidden,
 * window minimized). To honor the declarative intent ("keep awake *while* active"),
 * the Core keeps the desired flag (`_active`) and re-acquires the lock on the next
 * `visibilitychange` back to visible. So `_active` (desired) and `held` (actual)
 * diverge across an auto-release — and only `held` is published, because desired
 * does not change when the OS drops the lock.
 *
 * Never-throw: `request()` never rejects (a failure surfaces via `error`), and an
 * unsupported environment is a silent no-op (`held` stays false), consistent with
 * the other @wcstack sensors.
 */
export class WakeLockCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "held", event: "wcs-wakelock:held-changed" },
      { name: "error", event: "wcs-wakelock:error" },
      // Serializable failure taxonomy (stable code / phase / recoverable), or null.
      // Additive bindable output derived from the raw `error` (not-allowed / wakelock-error);
      // the existing `error` property/event are unchanged. Fires
      // wcs-wakelock:error-info-changed. No lane — the wake lock is a pure sink (request /
      // release do not compete).
      { name: "errorInfo", event: "wcs-wakelock:error-info-changed" },
    ],
    commands: [
      { name: "request", async: true },
      { name: "release" },
    ],
  };

  private _target: EventTarget;
  private _type: WakeLockKind;

  // `_active` is the desired intent (input); `_held` is whether a sentinel is
  // actually held right now (output). They diverge across an OS auto-release.
  private _active: boolean = false;
  private _held: boolean = false;
  private _error: Error | null = null;
  private _errorInfo: WcsIoErrorInfo | null = null;
  private _sentinel: WakeLockSentinelLike | null = null;

  // Bumped on every release()/new acquire so an in-flight async request() that
  // resolves late can detect it was superseded and drop its sentinel (mirrors the
  // generation guards in GeolocationCore).
  private _gen: number = 0;
  // True while an `_acquire()` is awaiting `navigator.wakeLock.request()`. The
  // `_held` flag is only set *after* that await resolves, so it cannot guard
  // against concurrent entry: two rapid visibilitychange events (or a Shell toggle
  // overlapping an in-flight request) would both pass `!this._held` and each call
  // `request()`. This in-flight flag closes that window — a re-entrant acquire is a
  // no-op. The `_gen` guard still ensures the *final* state is correct; this just
  // avoids the redundant `request()` call (and its duplicate error path on a denied
  // environment).
  private _acquiring: boolean = false;
  private _visibilityBound: boolean = false;

  // SSR (§3.8): a pure sink has no asynchronous probe to await — `request()` is
  // fire-and-forget and meaningless server-side — so readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget, type: WakeLockKind = "screen") {
    super();
    this._target = target ?? this;
    this._type = type;
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  // Lifecycle (§3.5). The wake lock is command-driven (request / release) with no
  // ambient subscription to establish on connect, so observe() is an idempotent
  // no-op that resolves once ready; dispose() (below) tears down the visibility
  // listener, releases any held sentinel, and bumps _gen via release().
  observe(): Promise<void> {
    return this._ready;
  }

  get held(): boolean {
    return this._held;
  }

  get error(): Error | null {
    return this._error;
  }

  /**
   * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
   * `recoverable`), or null. Additive wc-bindable property (event
   * `wcs-wakelock:error-info-changed`), derived from `error`; the existing `error`
   * property/event are unchanged.
   */
  get errorInfo(): WcsIoErrorInfo | null {
    return this._errorInfo;
  }

  /** The desired intent. Read-only reflection; not a wc-bindable property (it does
   * not change on an OS auto-release, so there is nothing to observe). */
  get active(): boolean {
    return this._active;
  }

  get type(): WakeLockKind {
    return this._type;
  }

  set type(value: WakeLockKind) {
    // Currently effectively a no-op: "screen" is the only standardized lock type,
    // so `WakeLockKind` is a single value and this setter never observes a real
    // change. Kept as a forward-compatible seam for when the spec adds lock types.
    //
    // Takes effect on the next acquire. Changing the type mid-hold deliberately does
    // NOT re-acquire — the live sentinel is left as is, so a type change applies only
    // from the following acquire. If multiple lock types are ever added this becomes
    // an observable behavior gap (a held lock keeps its old type until release/re-
    // acquire) and must be re-examined — likely re-acquire here when held.
    this._type = value;
  }

  // --- State setters with event dispatch ---

  private _setHeld(held: boolean): void {
    if (this._held === held) return;
    this._held = held;
    this._target.dispatchEvent(new CustomEvent("wcs-wakelock:held-changed", {
      detail: held,
      bubbles: true,
    }));
  }

  private _setError(error: Error | null): void {
    // Value guard, not just reference: a denied request rejects with a *fresh*
    // Error on every visibility-driven retry, so a reference compare would let a
    // permanently-denied environment re-dispatch the same failure on each
    // hidden→visible toggle. Compare name+message too. Transitions through null (a
    // success clears the error) always re-fire, so a genuinely new failure is seen.
    if (this._sameError(this._error, error)) return;
    this._error = error;
    // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the raw
    // Error (or null on clear). Fires before the `error` event so an observer binding
    // both sees the classification first, mirroring the io-node family.
    this._commitErrorInfo(error === null ? null : deriveWakeLockErrorInfo(error));
    this._target.dispatchEvent(new CustomEvent("wcs-wakelock:error", {
      detail: error,
      bubbles: true,
    }));
  }

  // Called only from _setError (which already same-value-guards on the error name +
  // message via _sameError), so errorInfo transitions exactly when error does — no
  // separate guard needed here.
  private _commitErrorInfo(info: WcsIoErrorInfo | null): void {
    this._errorInfo = info;
    this._target.dispatchEvent(new CustomEvent("wcs-wakelock:error-info-changed", {
      detail: info,
      bubbles: true,
    }));
  }

  private _sameError(a: Error | null, b: Error | null): boolean {
    if (a === b) return true;
    if (a !== null && b !== null) return a.name === b.name && a.message === b.message;
    return false;
  }

  // --- Public API ---

  /**
   * Mark the lock as desired and acquire it. Idempotent while already held. If the
   * API is unavailable or the page is currently hidden, the desired flag is still
   * set (so the lock is acquired on the next return to visibility) but nothing is
   * acquired now. Never rejects — a request failure surfaces via `error`.
   */
  async request(): Promise<void> {
    this._active = true;
    this._ensureVisibilityListener();
    await this._acquire();
  }

  /** Mark the lock as no longer desired and release any held sentinel. */
  release(): void {
    this._active = false;
    // Invalidate any in-flight acquire so a late-resolving request() drops its
    // sentinel instead of leaving a lock held after release.
    this._gen++;
    const sentinel = this._sentinel;
    if (sentinel) {
      this._sentinel = null;
      sentinel.removeEventListener("release", this._onRelease);
      void sentinel.release().catch(() => { /* never-throw */ });
    }
    this._setHeld(false);
  }

  /**
   * Full teardown: remove the visibility listener and release any held sentinel.
   * Call from the Shell's `disconnectedCallback`.
   *
   * Semantics: this is a terminal teardown, not a pause. After `dispose()` the Core
   * is meant to be discarded — there is no re-arm step, and the visibility listener
   * is gone, so an OS auto-release will no longer be followed by a re-acquire. A
   * later `request()` would still work in isolation (it re-attaches the listener via
   * `_ensureVisibilityListener`), but reusing a disposed Core is not an intended path;
   * the Shell always constructs a fresh Core per element instead.
   */
  dispose(): void {
    if (this._visibilityBound) {
      // §4 deviation: document-scoped Web API; no element-free alternative — the
      // Page Visibility `visibilitychange` event is only dispatched on `document`.
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
      this._visibilityBound = false;
    }
    this.release();
  }

  // --- Internal ---

  private async _acquire(): Promise<void> {
    if (this._held) return; // idempotent: already holding a sentinel
    if (this._acquiring) return; // an acquire is already in flight — don't double-request
    const wakeLock = this._wakeLock();
    if (!wakeLock) return; // unsupported — stay active, never acquire (silent no-op)
    if (!this._isVisible()) return; // hidden — defer to the next visibilitychange
    const gen = ++this._gen;
    this._acquiring = true;
    // Flag management is centralized in `finally` and the coalesced retry is invoked
    // exactly once, AFTER the try/catch/finally settles. This keeps the reject and
    // resolve paths symmetric: neither calls `_retryIfStillDesired()` from inside the
    // try/catch (which would let `finally` re-clear the `_acquiring=true` the retry's
    // synchronous re-entry just set, reopening the double-request window). `superseded`
    // records that a newer release()/request() bumped `_gen` mid-flight so its still-
    // live intent — blocked by the in-flight guard at the time — gets one retry here.
    // NOTE: no early `return` inside the try/catch below — every branch must fall
    // through to the post-`finally` retry. A `return` from inside the try would run
    // `finally` and then exit the function, skipping the `if (superseded)` retry.
    let superseded = false;
    let sentinel: WakeLockSentinelLike | null = null;
    let failed: Error | null = null;
    try {
      sentinel = await wakeLock.request(this._type);
    } catch (e) {
      if (gen !== this._gen) {
        // Superseded while awaiting — drop this stale failure (do not clobber the
        // newer state) and let the post-finally retry honor the live intent.
        superseded = true;
      } else {
        failed = this._normalizeError(e);
      }
    } finally {
      // The sole owner of the flag clears it here — on every exit path. A concurrent
      // re-entrant `_acquire()` was a no-op at the `_acquiring` guard, so it never owns
      // the flag; a superseding release()/acquire only bumps `_gen` and does not start
      // its own in-flight cycle until this clears the flag. Because this runs before
      // the retry below, the retry's `_acquiring=true` is never clobbered.
      this._acquiring = false;
    }

    if (sentinel !== null && gen !== this._gen) {
      // release() (or a newer acquire) ran while we awaited — this sentinel is
      // unwanted; drop it so no lock lingers, and retry the newer intent below.
      void sentinel.release().catch(() => { /* never-throw */ });
      superseded = true;
    } else if (sentinel !== null) {
      this._sentinel = sentinel;
      sentinel.addEventListener("release", this._onRelease);
      this._setError(null);
      this._setHeld(true);
    } else if (failed !== null) {
      // A live (non-superseded) failure: surface it. Never retried — the intent is
      // honored but the environment denied it, so looping would spin.
      this._setError(failed);
      this._setHeld(false);
    }

    // Coalesced retry: at most one re-attempt per supersession, after the flag is
    // clear. The `_acquiring` guard inside still protects any concurrent re-entry that
    // overlaps THIS retry's own in-flight window (reject- and resolve-retry alike).
    if (superseded) this._retryIfStillDesired();
  }

  /**
   * Re-attempt an acquire after an in-flight one was *superseded* (its generation no
   * longer matches), but only if the lock is still desired, not already held, and the
   * page is visible. This recovers a request() that was coalesced away by the
   * in-flight `_acquiring` guard: during a release()→request() overlap, the second
   * request() bumps `_gen` and is a no-op at the guard, so without this retry its
   * still-live intent would be lost until the next visibilitychange or manual call.
   *
   * Bounded — cannot loop forever: a retry runs ONLY on supersession, and a
   * supersession requires an external release()/request() to bump `_gen` mid-flight.
   * A retry's own `_acquire()`, if it is itself not superseded, terminates by either
   * acquiring (held=true) or recording the live failure (held=false, error set) —
   * neither path retries. So a denied environment that keeps rejecting does not
   * recurse; the retry chain length is bounded by the number of external overlaps.
   */
  private _retryIfStillDesired(): void {
    if (this._active && !this._held && this._isVisible()) {
      void this._acquire();
    }
  }

  // Fired for an OS release of a held sentinel — which the spec allows for several
  // reasons, NOT only a visibility change: tab hidden / window minimized, but also
  // battery-low, power-saver mode, etc. while the page stays visible. We reflect
  // held=false, then (lease renewal) re-acquire immediately IF the page is still
  // visible and the lock is still desired — because a visible-context release emits no
  // `visibilitychange`, so the visibilitychange listener (②) would never fire and the
  // lock would stay stuck at desired=true / held=false. The hidden case is the no-op
  // here: re-acquire is gated on `_isVisible()`, so a hide-driven release defers to ②
  // (re-acquire on the return to visibility), avoiding a release→acquire loop while
  // hidden.
  private _onRelease = (): void => {
    // The `if (this._sentinel)` false branch is defensive and unreachable in practice:
    // this listener is only ever attached to the live `_sentinel`, and the only paths
    // that null `_sentinel` (this handler itself, and release()) remove this listener
    // in the same step — so the listener and a non-null `_sentinel` are coupled and
    // this never fires with `_sentinel === null`. Guarded anyway in case a host
    // dispatches a spurious second "release". (c8 ignore the unhittable else.)
    /* c8 ignore next */
    if (this._sentinel) {
      this._sentinel.removeEventListener("release", this._onRelease);
      this._sentinel = null;
    }
    this._setHeld(false);
    this._reacquireAfterRelease();
  };

  /**
   * Lease renewal after an OS release while the page is still visible. Honors the
   * "keep awake *while* active" promise for releases that do NOT coincide with a
   * visibility change (battery-low / power-saver), which otherwise leave the lock
   * stuck at desired=true / held=false until the next hide→show cycle.
   *
   * Bounded on failure: this only runs from `_onRelease`, which only fires when a
   * sentinel was genuinely acquired and then released. A re-acquire that FAILS takes
   * `_acquire()`'s live-failure path (error recorded, held=false) and attaches no
   * listener, so it cannot re-enter `_onRelease` — a denied environment records the
   * error once and stops. This is the dominant real path: per the Wake Lock spec a
   * re-request under battery-low / power-saver is rejected (`NotAllowedError`), so the
   * renewal terminates there.
   *
   * The one path NOT bounded by a counter is a pathological host that keeps GRANTING
   * the re-request and then immediately auto-releasing it (grant→release reflux). Each
   * iteration yields to the event loop and consumes a real OS grant, so it is not a
   * tight/synchronous loop, but it would churn request() calls. We deliberately do NOT
   * add a debounce or renewal cap: that reflux is not documented browser behavior
   * (real browsers reject, not grant-then-revoke), and the extra timing state would
   * complicate the pure-sink design to defend a case that does not occur in practice.
   *
   * The `_isVisible()` / `!_acquiring` guards (doubled by `_acquire()`'s own in-flight
   * and held guards) prevent re-entry during an in-flight acquire and while hidden.
   */
  private _reacquireAfterRelease(): void {
    if (this._active && this._isVisible() && !this._acquiring) {
      void this._acquire();
    }
  }

  // ② Re-acquire when the page becomes visible again while the lock is still
  // desired but was auto-released. This is what makes `active` a durable intent.
  private _onVisibilityChange = (): void => {
    if (this._isVisible() && this._active && !this._held) {
      void this._acquire();
    }
  };

  private _ensureVisibilityListener(): void {
    if (this._visibilityBound) return;
    // §4 deviation: document-scoped Web API; no element-free alternative — the
    // Page Visibility `visibilitychange` event is only dispatched on `document`.
    document.addEventListener("visibilitychange", this._onVisibilityChange);
    this._visibilityBound = true;
  }

  private _wakeLock(): WakeLockLike | null {
    return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock ?? null;
  }

  private _isVisible(): boolean {
    // §4 deviation: document-scoped Web API; no element-free alternative —
    // `visibilityState` lives on `document`, not on any element.
    return document.visibilityState === "visible";
  }

  private _normalizeError(e: unknown): Error {
    return e instanceof Error ? e : new Error(String(e));
  }
}

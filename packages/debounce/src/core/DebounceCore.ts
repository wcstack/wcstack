import { IWcBindable, DebounceOptions } from "../types.js";
import { makeDebounceProperties } from "../wcBindableFactory.js";

type PendingKind = "value" | "signal" | null;

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
export class DebounceCore extends EventTarget {
  // The static contract advertises the *default* `wcs-debounce:*` event names. A
  // headless Core constructed with a non-default `eventPrefix` (e.g.
  // `"wcs-throttle"`) dispatches under that prefix, so its events won't match
  // this metadata — rebuild the property table with `makeDebounceProperties(prefix)`
  // for that case. (The `<wcs-throttle>` Shell already overrides its own
  // `wcBindable` this way, so binding through an element is always consistent.)
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: makeDebounceProperties("wcs-debounce"),
    commands: [
      { name: "trigger" },
      { name: "cancel" },
      { name: "flush" },
    ],
  };

  private readonly _prefix: string;
  private _target: EventTarget;

  // Tuning (lodash knobs).
  private _wait: number = 0;
  private _leading: boolean = false;
  private _trailing: boolean = true;
  private _maxWait: number = 0;
  private _hasMaxWait: boolean = false;

  // Timing bookkeeping.
  private _lastCallTime: number | undefined = undefined;
  private _lastInvokeTime: number = 0;
  private _timerId: ReturnType<typeof setTimeout> | null = null;
  // Generation stamped onto the live timer at arm time, compared in
  // `_timerExpired` against `_gen` to drop callbacks that outlived a dispose().
  private _timerGen: number = 0;

  // Last-wins pending payload. `_pendingKind === null` doubles as the "consumed /
  // empty" sentinel (lodash clears `lastArgs` in invokeFunc): a trailing edge with
  // no fresh call since the last fire sees `null` and does not re-fire, which is
  // what stops a single leading pulse from also firing on the trailing edge.
  private _pendingKind: PendingKind = null;
  private _pendingValue: any = undefined;
  private _pendingArgs: any[] | undefined = undefined;

  // Observable state (getter backing).
  private _value: any = undefined;
  private _lastArgs: any[] = [];
  private _pending: boolean = false;

  // Generation guard (§3.4): bumped on dispose() so a timer that survives a
  // tear-down can no longer settle into a detached element. A pending timer is
  // also cleared by dispose() → cancel(), so the guard is defensive: it stops
  // any callback that has already been dequeued by the host event loop from
  // writing state after dispose().
  private _gen = 0;
  // SSR (§3.8): the debounce engine is purely timer-driven with no asynchronous
  // probe to await, so readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  constructor(prefix: string = "wcs-debounce", target?: EventTarget, options?: DebounceOptions) {
    super();
    this._prefix = prefix;
    this._target = target ?? this;
    if (options) {
      this.configure(options);
    }
  }

  // --- Lifecycle (§3.5 / §3.8) ---

  get ready(): Promise<void> {
    return this._ready;
  }

  // Debounce is command-driven (setSource / trigger schedule work on demand)
  // with no subscription to establish, so observe() is an idempotent no-op that
  // resolves once ready.
  observe(): Promise<void> {
    return this._ready;
  }

  // Tear down the pending timer and invalidate the generation so a stale timer
  // callback cannot fire after the element is detached.
  dispose(): void {
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
  configure(options: DebounceOptions = {}): void {
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
    } else {
      this._maxWait = 0;
      this._hasMaxWait = false;
    }
  }

  // --- Observable getters ---

  get value(): any {
    return this._value;
  }

  get fired(): any[] {
    return this._lastArgs;
  }

  get pending(): boolean {
    return this._pending;
  }

  // --- Public entry points ---

  /** Value surface: schedule a settle carrying `value` (last write wins). */
  setSource(value: any): void {
    this._schedule("value", value, undefined);
  }

  /** Signal surface: coalesce a pulse carrying `args` (last call wins). */
  trigger(...args: any[]): void {
    this._schedule("signal", undefined, args);
  }

  /** Drop any pending fire without emitting. Getters keep their last values. */
  cancel(): void {
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
  flush(): void {
    if (this._timerId === null && this._pendingKind === null) return;
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

  private _schedule(kind: Exclude<PendingKind, null>, value: any, args: any[] | undefined): void {
    const now = Date.now();
    const isInvoking = this._shouldInvoke(now);

    this._pendingKind = kind;
    if (kind === "value") {
      this._pendingValue = value;
    } else {
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

  private _shouldInvoke(now: number): boolean {
    if (this._lastCallTime === undefined) return true;
    const timeSinceLastCall = now - this._lastCallTime;
    const timeSinceLastInvoke = now - this._lastInvokeTime;
    return (
      timeSinceLastCall >= this._wait ||
      timeSinceLastCall < 0 ||
      (this._hasMaxWait && timeSinceLastInvoke >= this._maxWait)
    );
  }

  private _remainingWait(now: number): number {
    const timeSinceLastCall = now - (this._lastCallTime as number);
    const timeSinceLastInvoke = now - this._lastInvokeTime;
    const timeWaiting = this._wait - timeSinceLastCall;
    return this._hasMaxWait
      ? Math.min(timeWaiting, this._maxWait - timeSinceLastInvoke)
      : timeWaiting;
  }

  private _timerExpired = (): void => {
    // §3.4 generation guard: a timer dequeued by the host before dispose() could
    // clear it must not settle into a torn-down element. Capture the generation
    // when the timer is scheduled (via `_armTimer`) and bail if it is stale.
    if (this._timerGen !== this._gen) return;
    const now = Date.now();
    if (this._shouldInvoke(now)) {
      this._trailingEdge(now);
      return;
    }
    // Fired before the quiet period elapsed (a later call moved the deadline) —
    // re-arm for the remaining time instead of settling now.
    this._armTimer(this._remainingWait(now));
  };

  private _leadingEdge(now: number): void {
    this._lastInvokeTime = now;
    this._armTimer(this._wait);
    if (this._leading) {
      this._invoke(now);
    }
  }

  private _trailingEdge(now: number): void {
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

  private _invoke(now: number): void {
    this._lastInvokeTime = now;
    const kind = this._pendingKind;
    if (kind === "value") {
      this._value = this._pendingValue;
      this._dispatch(`${this._prefix}:settled`, { value: this._value });
    } else if (kind === "signal") {
      this._lastArgs = this._pendingArgs ?? [];
      this._dispatch(`${this._prefix}:fired`, { args: this._lastArgs });
    }
    // Mark consumed (mirrors lodash clearing `lastArgs`).
    this._pendingKind = null;
  }

  private _setPending(pending: boolean): void {
    if (this._pending === pending) return;
    this._pending = pending;
    this._dispatch(`${this._prefix}:pending-changed`, pending);
  }

  private _dispatch(type: string, detail: any): void {
    this._target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }

  // Arm the settle timer, stamping the current generation so a callback that the
  // host dequeues after a dispose() can detect it is stale (§3.4).
  private _armTimer(delay: number): void {
    this._timerGen = this._gen;
    this._timerId = setTimeout(this._timerExpired, delay);
  }

  private _clearTimer(): void {
    if (this._timerId !== null) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
  }
}

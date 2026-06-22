import { IWcBindable } from "../types.js";

export interface TimerStartOptions {
  interval?: number;
  repeat?: number;
  immediate?: boolean;
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
export class TimerCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "tick", event: "wcs-timer:tick", getter: (e: Event) => (e as CustomEvent).detail.count },
      { name: "elapsed", event: "wcs-timer:tick", getter: (e: Event) => (e as CustomEvent).detail.elapsed },
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

  private _target: EventTarget;
  private _timerId: ReturnType<typeof setInterval> | null = null;

  // Generation guard (§3.4): bumped on dispose() and at every async start
  // (start()/resume()). A scheduled callback (setInterval/setTimeout) captures the
  // generation live via `_gen`; a fire that was already queued when the timer was
  // torn down — or superseded by a new run — has a stale gen and MUST NOT mutate
  // state or dispatch on a disposed element. _clearTimer() removes the handle, but
  // the guard is the belt-and-braces defense for a callback already in the queue.
  private _gen = 0;
  // Generation captured for the currently scheduled run, set at each async start
  // (start()/resume()). A scheduled callback compares it against the live `_gen`;
  // a stale callback (dispose() bumped `_gen` after this run was armed) bails.
  private _runGen = 0;
  // SSR (§3.8): the timer does no asynchronous probe, so readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  private _tick: number = 0;
  private _running: boolean = false;
  private _paused: boolean = false;

  // `_tick` value captured at the start of the current run. `repeat` counts ticks
  // *per run*, so the stop condition compares against this baseline rather than the
  // cumulative `_tick` (which only resets on reset()). Without it, re-starting a
  // completed bounded timer would stop after a single tick.
  private _runStartTick: number = 0;

  // Timer configuration (captured on start, reused by pause/resume).
  // `_immediate` is intentionally NOT a field: it is per-run intent consumed
  // entirely within start() (fire once, then schedule), so it lives as a local
  // there rather than lingering as instance state no other method reads.
  private _interval: number = 1000;
  private _repeat: number = 0;       // 0 = unlimited

  // Elapsed-time bookkeeping. `_accumulatedElapsed` holds the time folded from
  // already-finished running segments; `_segmentStart` is the timestamp the
  // current running segment began (null when not running). The live elapsed is
  // the sum of the two — see _currentElapsed().
  private _accumulatedElapsed: number = 0;
  private _segmentStart: number | null = null;

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get tick(): number {
    return this._tick;
  }

  get elapsed(): number {
    return this._currentElapsed();
  }

  get running(): boolean {
    return this._running;
  }

  // SSR readiness (§3.8): resolves after the first probe. The timer is
  // command-driven with nothing to probe, so this is an already-resolved promise.
  get ready(): Promise<void> {
    return this._ready;
  }

  // Lifecycle (§3.5). The timer is command-driven (start/stop/...) with no
  // ambient subscription to establish, so observe() is an idempotent no-op that
  // resolves once ready (mirroring UploadCore). dispose() tears the timer down —
  // it stops any running interval and bumps the generation so a callback already
  // queued cannot fire onto a torn-down element.
  observe(): Promise<void> {
    return this._ready;
  }

  dispose(): void {
    this._gen++;
    this.stop();
  }

  // --- State setters with event dispatch ---

  private _dispatchTick(): void {
    this._target.dispatchEvent(new CustomEvent("wcs-timer:tick", {
      detail: { count: this._tick, elapsed: this._currentElapsed() },
      bubbles: true,
    }));
  }

  private _setRunning(running: boolean): void {
    if (this._running === running) return;
    this._running = running;
    this._target.dispatchEvent(new CustomEvent("wcs-timer:running-changed", {
      detail: running,
      bubbles: true,
    }));
  }

  // --- Public API ---

  start(options: TimerStartOptions = {}): void {
    // Idempotent while running: a redundant start() must not stack a second
    // setInterval (which would leak and double the tick rate). Reconfiguring an
    // active timer is done via stop() + start().
    if (this._running) return;

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
    // `repeat` is a field (pause/resume/_fire read it across the run); `immediate`
    // is consumed here and now, so it stays a local.
    this._repeat = (typeof options.repeat === "number" && options.repeat > 0) ? options.repeat : 0;
    const immediate = options.immediate === true;

    this._setRunning(true);
    this._segmentStart = Date.now();
    // Baseline this run's per-run repeat counting (set after _setRunning so a
    // re-start of a completed bounded timer fires the full N ticks again).
    this._runStartTick = this._tick;
    // Capture this run's generation (§3.4): a scheduled fire that outlives a
    // dispose() (which bumps `_gen`) is then recognised as stale and ignored.
    this._runGen = ++this._gen;

    // Fire immediately on start when requested. _fire() may stop the timer (when
    // repeat is reached), so re-check _running before scheduling the interval.
    if (immediate) {
      this._fire();
    }
    if (this._running) {
      this._timerId = setInterval(this._fire, this._interval);
    }
  }

  // Swap the tick period of a live timer in place, WITHOUT re-running start().
  // Unlike stop() + start(), this leaves the per-run repeat progress in flight
  // (`_repeat` and its `_runStartTick` baseline) untouched, so a bounded
  // `repeat="N"` run is not re-baselined to fire N more times. It also never goes
  // through start()'s `immediate` path, so an `immediate` timer does not fire an
  // extra tick. Only re-arms the steady interval; pause()/resume() and reset() are
  // unaffected. No-op when not running (interval is then plain config, captured on
  // the next start) or when the new period is non-positive / non-finite (which
  // would turn setInterval into a hot loop and break resume()'s modulo arithmetic).
  changeInterval(interval: number): void {
    if (!this._running) return;
    if (!(typeof interval === "number" && Number.isFinite(interval) && interval > 0)) return;
    if (interval === this._interval) return;
    this._interval = interval;
    // Re-arm the steady ticking at the new period. The current period's progress
    // is intentionally discarded (the next tick is a full new interval away),
    // matching the boundary reset of the previous stop()+start() behaviour.
    this._clearTimer();
    this._timerId = setInterval(this._fire, this._interval);
  }

  stop(): void {
    this._clearTimer();
    this._foldElapsed();
    this._paused = false;
    this._setRunning(false);
  }

  reset(): void {
    this._clearTimer();
    this._paused = false;
    this._tick = 0;
    this._accumulatedElapsed = 0;
    this._segmentStart = null;
    this._setRunning(false);
    // Notify observers that the counter/elapsed have returned to zero.
    this._dispatchTick();
  }

  pause(): void {
    // Pause only a live timer; a no-op otherwise so it composes safely with the
    // declarative lifecycle. Unlike stop(), it records `_paused` so resume() can
    // tell an intentional pause from a full stop.
    if (!this._running || this._paused) return;
    this._clearTimer();
    this._foldElapsed();
    this._paused = true;
    this._setRunning(false);
  }

  resume(): void {
    if (!this._paused) return;
    this._paused = false;
    this._setRunning(true);
    this._segmentStart = Date.now();
    // New scheduled run after a pause: capture its generation (§3.4) so a
    // post-dispose() boundary/interval callback is recognised as stale.
    this._runGen = ++this._gen;
    // Invariant: `_interval` is fixed at start() and stays constant for the whole
    // pause/resume cycle — changeInterval() only mutates it while *running* (never
    // while paused), so the remainder arithmetic below can safely assume the same
    // period was in effect across the paused segment. Consequence for the Shell:
    // because the live interval-attribute path (attributeChangedCallback ->
    // changeInterval) is gated on `running`, an `interval` change made *while
    // paused* is silently not applied here; it is picked up only on the next
    // start() as plain config. This is by design — see README "Commands".
    // Resume seamlessly: a tick fires every `interval` ms of *running* time, so
    // honour the partial period consumed before the pause. Wait only the
    // remainder to the next boundary, then fall back to the steady interval.
    // (`accumulated % interval === 0` — paused exactly on a boundary — yields a
    // full interval, which is correct: the next tick is a whole period away.)
    const remainder = this._interval - (this._accumulatedElapsed % this._interval);
    this._timerId = setTimeout(this._onResumeBoundary, remainder);
  }

  // --- Internal ---

  private _onResumeBoundary = (): void => {
    // Stale-run guard (§3.4): a resume-boundary timeout that fires after dispose()
    // belongs to a torn-down run — drop it without re-arming the interval.
    if (this._runGen !== this._gen) return;
    this._timerId = null;
    this._fire();
    // _fire() may have auto-stopped the timer (repeat reached); only re-arm the
    // steady interval while still running.
    if (this._running) {
      this._timerId = setInterval(this._fire, this._interval);
    }
  };

  private _fire = (): void => {
    // Stale-run guard (§3.4): an interval callback queued before dispose() (which
    // bumps `_gen`) must not tick or dispatch onto a torn-down element.
    if (this._runGen !== this._gen) return;
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

  private _clearTimer(): void {
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

  private _foldElapsed(): void {
    if (this._segmentStart !== null) {
      this._accumulatedElapsed += Date.now() - this._segmentStart;
      this._segmentStart = null;
    }
  }

  private _currentElapsed(): number {
    return this._accumulatedElapsed +
      (this._segmentStart !== null ? Date.now() - this._segmentStart : 0);
  }
}

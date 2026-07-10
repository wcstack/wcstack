import { IWcBindable } from "../types.js";

export interface RafStartOptions {
  repeat?: number;
}

/**
 * Injectable frame scheduler. The default resolves
 * `globalThis.requestAnimationFrame` / `cancelAnimationFrame` AT CALL TIME
 * (async-io-node-guidelines §3.7); tests inject a fake that pumps frames with
 * explicit timestamps (the `dt` contract is timestamp-derived, so tests must
 * control the clock, not just the callback order).
 */
export interface RafScheduler {
  request(callback: (timestamp: number) => void): unknown;
  cancel(handle: unknown): void;
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
export class RafCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "tick", event: "wcs-raf:tick", getter: (e: Event) => (e as CustomEvent).detail.count },
      { name: "elapsed", event: "wcs-raf:tick", getter: (e: Event) => (e as CustomEvent).detail.elapsed },
      { name: "dt", event: "wcs-raf:tick", getter: (e: Event) => (e as CustomEvent).detail.dt },
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

  private _target: EventTarget;
  private _injectedScheduler: RafScheduler | null;
  private _handle: unknown = null;

  // Generation guard (§3.4): bumped on dispose() and at every scheduled run
  // (start()/resume()). A frame callback captures the generation live via
  // `_gen`; a frame that was already queued when the node was torn down — or
  // superseded by a new run — has a stale gen and MUST NOT mutate state or
  // dispatch on a disposed element. _clearHandle() cancels the handle, but the
  // guard is the belt-and-braces defense for a callback already in flight.
  private _gen = 0;
  private _runGen = 0;
  // SSR (§3.8): there is no asynchronous probe, so readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  private _tick: number = 0;
  private _dt: number = 0;
  private _elapsed: number = 0;
  private _running: boolean = false;
  private _suspended: boolean = false;
  private _paused: boolean = false;

  // Timestamp of the previous frame within the current continuous run.
  // `null` means "the next frame starts a run segment": its dt is reported as
  // 0 (the G3 normalization). Cleared at start()/resume() and on every
  // visibilitychange (an interruption boundary).
  private _lastTs: number | null = null;

  // `_tick` value captured at the start of the current run. `repeat` counts
  // frames *per run*, so the stop condition compares against this baseline
  // rather than the cumulative `_tick` (which only resets on reset()).
  private _repeat: number = 0;
  private _runStartTick: number = 0;

  // The document whose visibility drives `suspended`, subscribed in observe()
  // and released in dispose(). Null before observe() or in non-DOM
  // environments — `suspended` then simply stays false.
  private _visibilityDoc: Document | null = null;

  constructor(target?: EventTarget, scheduler?: RafScheduler) {
    super();
    this._target = target ?? this;
    this._injectedScheduler = scheduler ?? null;
  }

  get tick(): number {
    return this._tick;
  }

  get elapsed(): number {
    return this._elapsed;
  }

  get dt(): number {
    return this._dt;
  }

  get running(): boolean {
    return this._running;
  }

  get suspended(): boolean {
    return this._suspended;
  }

  // SSR readiness (§3.8): resolves after the first probe. There is nothing to
  // probe, so this is an already-resolved promise.
  get ready(): Promise<void> {
    return this._ready;
  }

  // Lifecycle (§3.5). observe() establishes the one ambient subscription this
  // node has — `visibilitychange`, which drives the `suspended` output and the
  // dt=0 normalization across a hidden period. Idempotent; a no-op without a
  // document (SSR pre-pass, worker). dispose() tears everything down and bumps
  // the generation so a frame already queued cannot fire onto a torn-down
  // element.
  observe(): Promise<void> {
    if (this._visibilityDoc === null && typeof document !== "undefined") {
      this._visibilityDoc = document;
      document.addEventListener("visibilitychange", this._onVisibilityChange);
    }
    return this._ready;
  }

  dispose(): void {
    this._gen++;
    this.stop();
    if (this._visibilityDoc !== null) {
      this._visibilityDoc.removeEventListener("visibilitychange", this._onVisibilityChange);
      this._visibilityDoc = null;
    }
  }

  // --- State setters with event dispatch ---

  private _dispatchTick(timestamp: number): void {
    this._target.dispatchEvent(new CustomEvent("wcs-raf:tick", {
      detail: { count: this._tick, elapsed: this._elapsed, dt: this._dt, timestamp },
      bubbles: true,
    }));
  }

  private _setRunning(running: boolean): void {
    if (this._running === running) return;
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

  private _setSuspended(suspended: boolean): void {
    if (this._suspended === suspended) return;
    this._suspended = suspended;
    this._target.dispatchEvent(new CustomEvent("wcs-raf:suspended-changed", {
      detail: suspended,
      bubbles: true,
    }));
  }

  private _updateSuspended(): void {
    const hidden = this._visibilityDoc !== null && this._visibilityDoc.visibilityState === "hidden";
    this._setSuspended(this._running && hidden);
  }

  // --- Public API ---

  start(options: RafStartOptions = {}): void {
    // Idempotent while running: a redundant start() must not stack a second
    // frame loop (which would double the tick rate). Reconfiguring an active
    // run is done via stop() + start().
    if (this._running) return;

    // Resolve the platform API at call time (§3.7). Absent rAF (SSR pre-pass,
    // worker) makes start() a silent no-op — never-throw, and this node has no
    // error surface by design.
    const scheduler = this._resolveScheduler();
    if (scheduler === null) return;

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

  stop(): void {
    this._clearHandle();
    this._paused = false;
    this._setRunning(false);
  }

  reset(): void {
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

  pause(): void {
    // Pause only a live loop; a no-op otherwise so it composes safely with the
    // declarative lifecycle. Unlike stop(), it records `_paused` so resume()
    // can tell an intentional pause from a full stop. No elapsed bookkeeping
    // is needed: elapsed is Σdt, and the resume boundary's dt is 0.
    if (!this._running || this._paused) return;
    this._clearHandle();
    this._paused = true;
    this._setRunning(false);
  }

  resume(): void {
    if (!this._paused) return;
    const scheduler = this._resolveScheduler();
    if (scheduler === null) return;
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

  private _frame = (timestamp: number): void => {
    // Stale-run guard (§3.4): a frame queued before dispose() (which bumps
    // `_gen`) must not tick or dispatch onto a torn-down element.
    if (this._runGen !== this._gen) return;
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

  private _onVisibilityChange = (): void => {
    // Either direction is an interruption boundary: entering hidden means the
    // browser stops delivering frames, so the NEXT delivered frame must not
    // report a delta spanning the gap (G3). Clearing on the visible edge too
    // is belt-and-braces for a missed hidden event — the worst case is one
    // extra dt=0 frame.
    this._lastTs = null;
    this._updateSuspended();
  };

  private _resolveScheduler(): RafScheduler | null {
    if (this._injectedScheduler !== null) return this._injectedScheduler;
    const g = globalThis as unknown as {
      requestAnimationFrame?: (cb: (ts: number) => void) => unknown;
      cancelAnimationFrame?: (handle: unknown) => void;
    };
    if (typeof g.requestAnimationFrame !== "function" || typeof g.cancelAnimationFrame !== "function") {
      return null;
    }
    return {
      request: (cb) => g.requestAnimationFrame!(cb),
      cancel: (handle) => g.cancelAnimationFrame!(handle),
    };
  }

  private _clearHandle(): void {
    if (this._handle !== null) {
      this._resolveScheduler()?.cancel(this._handle);
      this._handle = null;
    }
  }
}

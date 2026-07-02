import { IWcBindable, WcsAccelerometerReading, WcsAccelerometerErrorDetail } from "../types.js";

const NULL_READING: WcsAccelerometerReading = Object.freeze({ x: null, y: null, z: null });

/**
 * Headless Accelerometer primitive. A thin, framework-agnostic wrapper around
 * the Generic Sensor API's `Accelerometer` class exposed through the
 * wc-bindable protocol.
 *
 * The platform `Sensor` base class (shared by `Accelerometer` / `Gyroscope` /
 * `Magnetometer` / `AmbientLightSensor`) reports failure through an `'error'`
 * event rather than a rejected promise, so this Core can satisfy never-throw
 * (docs/async-io-node-guidelines.md §3.6) by simply forwarding that event —
 * see docs/accelerometer-tag-design.md §0. The one place a synchronous
 * exception *can* still escape the platform API is the `Accelerometer`
 * constructor itself (e.g. `SecurityError` on permission denial or a
 * feature-policy block); `_createSensor()` wraps that single call in
 * try/catch, mirroring FetchCore's `_doFetch` try/catch around
 * `globalThis.fetch` (packages/fetch/src/core/FetchCore.ts).
 *
 * `x`/`y`/`z` are three getters derived from the single `wcs-accelerometer:reading`
 * event (mirroring how NetworkCore exposes effectiveType/downlink/… from one
 * `wcs-network:change` event): the native `reading` event already reports all
 * three axes together, so they are not split into independent events. `reading`
 * is an event-like signal (a fresh sample every time, not a settled state) and
 * is therefore deliberately NOT same-value guarded — every sample dispatches.
 * `error` is state-like (denial / unsupported does not change from tick to
 * tick) and IS same-value guarded, and is published on its own
 * `wcs-accelerometer:error` event, independent of `reading`.
 *
 * No `_gen` generation guard: start()/stop() are a synchronous
 * subscribe/unsubscribe toggle with no asynchronous probe whose stale
 * resolution could race a dispose() — see docs/accelerometer-tag-design.md §1.5
 * (the same reasoning as NetworkCore, docs/network-tag-design.md §5).
 *
 * Permissions: this Core does not query `navigator.permissions` itself.
 * Compose with `<wcs-permission name="accelerometer">` instead — see
 * docs/accelerometer-tag-design.md §"Permissions API連携".
 */
export class AccelerometerCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "x", event: "wcs-accelerometer:reading", getter: (e: Event) => (e as CustomEvent).detail.x },
      { name: "y", event: "wcs-accelerometer:reading", getter: (e: Event) => (e as CustomEvent).detail.y },
      { name: "z", event: "wcs-accelerometer:reading", getter: (e: Event) => (e as CustomEvent).detail.z },
      { name: "error", event: "wcs-accelerometer:error" },
    ],
    commands: [{ name: "start" }, { name: "stop" }],
  };

  private _target: EventTarget;
  private _reading: WcsAccelerometerReading = NULL_READING;
  private _error: WcsAccelerometerErrorDetail | null = null;

  // The live sensor instance while started (null otherwise), kept so stop()
  // can remove its listeners precisely and so start() can detect "already
  // started" without a separate boolean (§3.5 idempotency).
  private _sensor: (EventTarget & { start(): void; stop(): void }) | null = null;

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get x(): number | null {
    return this._reading.x;
  }

  get y(): number | null {
    return this._reading.y;
  }

  get z(): number | null {
    return this._reading.z;
  }

  get error(): WcsAccelerometerErrorDetail | null {
    return this._error;
  }

  /** No asynchronous probe to await: start()/stop() are synchronous (§3.8 is
   *  satisfied trivially, mirroring NetworkCore). */
  get ready(): Promise<void> {
    return Promise.resolve();
  }

  // --- State setters ---

  // Deliberately NOT same-value guarded: a `reading` is a fresh sample, not a
  // settled state, so it must dispatch every time even when the values happen
  // to repeat (docs/accelerometer-tag-design.md §1.1 / §3).
  private _setReading(reading: WcsAccelerometerReading): void {
    this._reading = reading;
    this._target.dispatchEvent(new CustomEvent("wcs-accelerometer:reading", {
      detail: reading,
      bubbles: true,
    }));
  }

  private _setError(error: WcsAccelerometerErrorDetail | null): void {
    // Same-value guard (by error name): error is state-like, unlike reading.
    if (this._error?.error === error?.error && this._error?.message === error?.message) return;
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-accelerometer:error", {
      detail: error,
      bubbles: true,
    }));
  }

  // --- Public API ---

  /**
   * Start the sensor at the given `frequency` (Hz), or the platform default
   * when omitted. Idempotent while already started: a redundant start() does
   * not construct a second sensor instance (which would leak the first).
   * Restart with a different frequency via stop() + start().
   *
   * Synchronous, mirroring the native `Sensor.start()` — never throws
   * (docs/async-io-node-guidelines.md §3.6): both "unsupported" and a
   * synchronous constructor exception (permission denial, feature-policy
   * block) are converted to the `error` property instead of propagating.
   */
  start(frequency?: number): void {
    if (this._sensor) return;
    const sensor = this._createSensor(frequency);
    if (!sensor) return;
    sensor.addEventListener("reading", this._onReading as EventListener);
    sensor.addEventListener("error", this._onError as EventListener);
    this._sensor = sensor;
    try {
      sensor.start();
    } catch (e: any) {
      // Defensive: the platform contract says start()/stop() do not throw
      // (failures surface via the 'error' event), but never-throw is a hard
      // requirement here, so guard against a non-conformant implementation
      // too.
      this._teardownSensor();
      this._setError({ error: e?.name ?? "error", message: e?.message ?? String(e) });
    }
  }

  /** Stop the sensor and detach its listeners. Safe to call when not started. */
  stop(): void {
    if (!this._sensor) return;
    try {
      this._sensor.stop();
    } catch {
      // Never-throw defensive guard, symmetric with start(). Teardown below
      // still runs so listeners are detached regardless.
    }
    this._teardownSensor();
  }

  /** Lifecycle alias for start(), so the Shell's connectedCallback can drive
   *  this Core the same way as other IO nodes' observe()/dispose() pair. No
   *  asynchronous probe, so the returned promise always resolves immediately. */
  observe(frequency?: number): Promise<void> {
    this.start(frequency);
    return this.ready;
  }

  /** Lifecycle alias for stop(), invoked from the Shell's disconnectedCallback. */
  dispose(): void {
    this.stop();
  }

  // --- Internal ---

  // Both call sites (start()'s catch, stop()) only ever invoke this once
  // `this._sensor` is already known non-null, so there is no null-guard here
  // (nothing to defend against).
  private _teardownSensor(): void {
    this._sensor!.removeEventListener("reading", this._onReading as EventListener);
    this._sensor!.removeEventListener("error", this._onError as EventListener);
    this._sensor = null;
  }

  /**
   * Construct the platform `Accelerometer`, guarding both non-support and a
   * synchronous constructor exception. Never calls the raw `new Accelerometer(...)`
   * anywhere else in this class — see docs/accelerometer-tag-design.md §1.5.
   *
   * API resolution is call-time (§3.7): re-checked on every start(), never
   * cached, so tests can install/remove the global freely and an unsupported
   * environment is always reported correctly.
   */
  private _createSensor(frequency?: number): (EventTarget & { start(): void; stop(): void }) | null {
    const Ctor = (globalThis as any).Accelerometer;
    if (typeof Ctor !== "function") {
      this._setError({ error: "unsupported", message: "Accelerometer is not supported" });
      return null;
    }
    try {
      return new Ctor(frequency !== undefined ? { frequency } : undefined);
    } catch (e: any) {
      // SecurityError (permission denial, feature-policy block) or any other
      // synchronous construction failure. Mirrors the FetchCore._doFetch
      // try/catch structure (packages/fetch/src/core/FetchCore.ts) — a
      // synchronous constructor call here instead of an awaited fetch().
      this._setError({ error: e?.name ?? "error", message: e?.message ?? String(e) });
      return null;
    }
  }

  private _onReading = (event: Event): void => {
    const sensor = event.target as unknown as { x: number | null; y: number | null; z: number | null };
    this._setReading({ x: sensor.x, y: sensor.y, z: sensor.z });
  };

  private _onError = (event: Event): void => {
    const err = (event as any).error as { name?: string; message?: string } | undefined;
    this._setError({ error: err?.name ?? "error", message: err?.message ?? String(err) });
  };
}

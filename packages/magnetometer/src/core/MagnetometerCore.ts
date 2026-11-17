import { IWcBindable, WcsMagnetometerReading, WcsMagnetometerErrorDetail } from "../types.js";
import { WcsIoErrorInfo, featureUnavailable } from "./platformCapability.js";
import { deriveMagnetometerErrorInfo } from "./magnetometerCapabilities.js";

const NULL_READING: WcsMagnetometerReading = Object.freeze({ x: null, y: null, z: null });

type SensorLike = EventTarget & { start(): void; stop(): void };

/**
 * Headless Magnetometer primitive. A thin, framework-agnostic wrapper around
 * the Generic Sensor API's `Magnetometer` class exposed through the
 * wc-bindable protocol.
 *
 * The platform `Sensor` base class (shared by `Accelerometer` / `Gyroscope` /
 * `Magnetometer` / `AmbientLightSensor`) reports failure through an `'error'`
 * event rather than a rejected promise, so this Core can satisfy never-throw
 * (docs/async-io-node-guidelines.md §3.6) by simply forwarding that event —
 * see docs/sensor-tag-design.md §0. The one place a synchronous
 * exception *can* still escape the platform API is the `Magnetometer`
 * constructor itself (e.g. `SecurityError` on permission denial or a
 * feature-policy block); `_createSensor()` wraps that single call in
 * try/catch, mirroring FetchCore's `_doFetch` try/catch around
 * `globalThis.fetch` (packages/fetch/src/core/FetchCore.ts).
 *
 * `x`/`y`/`z` are three getters derived from the single `wcs-magnetometer:reading`
 * event (mirroring how NetworkCore exposes effectiveType/downlink/… from one
 * `wcs-network:change` event): the native `reading` event already reports all
 * three axes together, so they are not split into independent events. `reading`
 * is an event-like signal (a fresh sample every time, not a settled state) and
 * is therefore deliberately NOT same-value guarded — every sample dispatches.
 * `error` is state-like (denial / unsupported does not change from tick to
 * tick) and IS same-value guarded, and is published on its own
 * `wcs-magnetometer:error` event, independent of `reading`.
 *
 * No `_gen` generation guard: start()/stop() are a synchronous
 * subscribe/unsubscribe toggle with no asynchronous probe whose stale
 * resolution could race a dispose() — see docs/sensor-tag-design.md §1.5
 * (the same reasoning as NetworkCore, docs/network-tag-design.md §5).
 *
 * Permissions: this Core does not query `navigator.permissions` itself.
 * Compose with `<wcs-permission name="magnetometer">` instead — see
 * docs/sensor-tag-design.md §"2番目の決定: Permissions APIとの合成".
 */
export class MagnetometerCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "x", event: "wcs-magnetometer:reading", semantics: "state", getter: (e: Event) => (e as CustomEvent).detail.x },
      { name: "y", event: "wcs-magnetometer:reading", semantics: "state", getter: (e: Event) => (e as CustomEvent).detail.y },
      { name: "z", event: "wcs-magnetometer:reading", semantics: "state", getter: (e: Event) => (e as CustomEvent).detail.z },
      { name: "error", event: "wcs-magnetometer:error", semantics: "state" },
      // Serializable failure taxonomy (stable code / phase / recoverable), or null.
      // Additive bindable output derived from `error.error` (the Error.name /
      // "unsupported"); the existing `error` property/event are unchanged. Fires
      // wcs-magnetometer:error-info-changed. No lane — the sensor is a monitor.
      { name: "errorInfo", event: "wcs-magnetometer:error-info-changed", semantics: "state" },
      // This page can use the sensor: the `Magnetometer` class is there and neither a
      // Permissions-Policy nor an insecure context forbids it. Not whether the
      // device has a sensor, and not whether the user will allow it.
      { name: "supported", event: "wcs-magnetometer:supported-changed", semantics: "state" },
    ],
    commands: [{ name: "start" }, { name: "stop" }],
  };

  private _target: EventTarget;
  private _reading: WcsMagnetometerReading = NULL_READING;
  private _error: WcsMagnetometerErrorDetail | null = null;
  private _errorInfo: WcsIoErrorInfo | null = null;
  // The value the last wcs-magnetometer:supported-changed carried (none yet: false).
  private _supportedPublished = false;

  // The live sensor instance while started (null otherwise), kept so stop()
  // can remove its listeners precisely and so start() can detect "already
  // started" without a separate boolean (docs/async-io-node-guidelines.md
  // §3.5 idempotency).
  private _sensor: SensorLike | null = null;

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

  get error(): WcsMagnetometerErrorDetail | null {
    return this._error;
  }

  /**
   * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
   * `recoverable`), or null. Additive wc-bindable property (event
   * `wcs-magnetometer:error-info-changed`), derived from `error`; the existing
   * `error` property/event are unchanged.
   */
  get errorInfo(): WcsIoErrorInfo | null {
    return this._errorInfo;
  }

  /**
   * Whether this page can use the sensor: the `Magnetometer` class is there, and
   * neither an insecure context nor a Permissions-Policy that forbids
   * `magnetometer` is in the way. Read at call time, never cached. It cannot
   * say whether the device has a sensor.
   */
  get supported(): boolean {
    return typeof (globalThis as any).Magnetometer === "function" && featureUnavailable("magnetometer") === null;
  }

  /** No asynchronous probe to await: start()/stop() are synchronous
   *  (docs/async-io-node-guidelines.md §3.8 is satisfied trivially, mirroring
   *  NetworkCore). */
  get ready(): Promise<void> {
    return Promise.resolve();
  }

  // --- State setters ---

  // Deliberately NOT same-value guarded: a `reading` is a fresh sample, not a
  // settled state, so it must dispatch every time even when the values happen
  // to repeat (docs/sensor-tag-design.md §1.1).
  private _setReading(reading: WcsMagnetometerReading): void {
    this._reading = reading;
    this._target.dispatchEvent(new CustomEvent("wcs-magnetometer:reading", {
      detail: reading,
      bubbles: true,
    }));
  }

  private _setError(error: WcsMagnetometerErrorDetail | null): void {
    // Same-value guard (by error name + message): error is state-like, unlike
    // reading — a repeated identical error (same name and message) must not
    // redispatch. Note `error` is also STICKY: nothing calls _setError(null),
    // so a successful (re)start does not clear a prior failure — the monitoring
    // sensor family deliberately keeps the last observed error (docs/sensor-tag-design.md §1.5).
    if (this._error?.error === error?.error && this._error?.message === error?.message) return;
    this._error = error;
    // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the
    // error name (or null on clear). Fires before the `error` event so an observer
    // binding both sees the classification first, mirroring the io-node family.
    this._commitErrorInfo(error === null ? null : deriveMagnetometerErrorInfo(error.error, error.message));
    this._target.dispatchEvent(new CustomEvent("wcs-magnetometer:error", {
      detail: error,
      bubbles: true,
    }));
  }

  // Called only from _setError (which already same-value-guards on the error name
  // + message), so errorInfo transitions exactly when error does — no separate
  // guard needed here.
  private _commitErrorInfo(info: WcsIoErrorInfo | null): void {
    this._errorInfo = info;
    this._target.dispatchEvent(new CustomEvent("wcs-magnetometer:error-info-changed", {
      detail: info,
      bubbles: true,
    }));
  }

  // --- Public API ---

  /**
   * Dispatch `wcs-magnetometer:supported-changed` when `supported` differs
   * from the value last dispatched (false before the first). The Shell calls it
   * on connect, so a listener other than a binding — which reads the property
   * when it binds — learns the value too.
   */
  publishSupported(): void {
    const supported = this.supported;
    if (this._supportedPublished === supported) return;
    this._supportedPublished = supported;
    this._target.dispatchEvent(new CustomEvent("wcs-magnetometer:supported-changed", {
      detail: supported,
      bubbles: true,
    }));
  }

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
      this._teardownSensor(sensor);
      this._setError({ error: e?.name ?? "error", message: e?.message ?? String(e) });
    }
  }

  /** Stop the sensor and detach its listeners. Safe to call when not started. */
  stop(): void {
    if (!this._sensor) return;
    const sensor = this._sensor;
    try {
      sensor.stop();
    } catch {
      // Never-throw defensive guard, symmetric with start(). Teardown below
      // still runs so listeners are detached regardless.
    }
    this._teardownSensor(sensor);
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

  // Detach a sensor that is finished: stopped, failed in start(), or reported
  // an `error` event. A sensor whose `error` event arrives while its start()
  // is still running, and whose start() then throws, is torn down twice: the
  // second time its listeners are already off, which removeEventListener
  // takes — and a start() from an `error` listener may have put a newer
  // sensor in its place by then, which stays.
  private _teardownSensor(sensor: SensorLike | null): void {
    sensor?.removeEventListener("reading", this._onReading as EventListener);
    sensor?.removeEventListener("error", this._onError as EventListener);
    if (this._sensor === sensor) this._sensor = null;
  }

  /**
   * Construct the platform `Magnetometer`, guarding both non-support and a
   * synchronous constructor exception. Never calls the raw `new Magnetometer(...)`
   * anywhere else in this class — see docs/sensor-tag-design.md §1.5.
   *
   * API resolution is call-time (docs/async-io-node-guidelines.md §3.7):
   * re-checked on every start(), never cached, so tests can install/remove
   * the global freely and an unsupported environment is always reported
   * correctly.
   */
  private _createSensor(frequency?: number): SensorLike | null {
    const Ctor = (globalThis as any).Magnetometer;
    if (typeof Ctor !== "function") {
      this._setError({ error: "unsupported", message: "Magnetometer is not supported" });
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
    // The sensor that reported the error is finished (the platform deactivates
    // it): detach it before publishing, so the next start() builds a fresh one
    // instead of taking this one for "already started". It is `_sensor`: this
    // listener is on a sensor only while that sensor is the current one.
    this._teardownSensor(this._sensor);
    // Fallback is a meaningful constant, NOT String(err): a SensorErrorEvent
    // without an `error` field would otherwise stringify `undefined` into the
    // literal message "undefined" (aligned across the sensor family).
    this._setError({ error: err?.name ?? "error", message: err?.message ?? "Sensor error" });
  };
}

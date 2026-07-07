interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
}
interface IWcBindableInput {
    readonly name: string;
    readonly attribute?: string;
}
interface IWcBindableCommand {
    readonly name: string;
    readonly async?: boolean;
}
interface IWcBindable {
    readonly protocol: "wc-bindable";
    readonly version: 1;
    readonly properties: readonly IWcBindableProperty[];
    readonly inputs?: readonly IWcBindableInput[];
    readonly commands?: readonly IWcBindableCommand[];
}

interface ITagNames {
    readonly accelerometer: string;
}
interface IWritableTagNames {
    accelerometer?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * A single `reading` sample from the Accelerometer sensor: linear acceleration
 * along the x/y/z axes, in m/s^2 (including gravity — this is the plain
 * `Accelerometer`, not `LinearAccelerationSensor`).
 */
interface WcsAccelerometerReading {
    x: number | null;
    y: number | null;
    z: number | null;
}
/**
 * Error detail published on the `wcs-accelerometer:error` event. Mirrors the
 * Generic Sensor API's `SensorErrorEvent.error` (a `DOMException`-like value)
 * flattened to a plain object, plus the synthetic `"unsupported"` name used
 * when the global `Accelerometer` constructor is absent.
 */
interface WcsAccelerometerErrorDetail {
    error: string;
    message: string;
}
/**
 * Value types for AccelerometerCore (headless) — the observable state
 * properties. Use with `bind()` from a wc-bindable binding core for
 * compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new AccelerometerCore();
 * bind(core, (name: keyof WcsAccelerometerCoreValues, value) => { ... });
 * ```
 */
interface WcsAccelerometerCoreValues extends WcsAccelerometerReading {
    error: WcsAccelerometerErrorDetail | null;
}
/**
 * Value types for the Shell (`<wcs-accelerometer>`) — identical observable
 * surface to the Core, plus the `frequency` attribute-backed input.
 */
type WcsAccelerometerValues = WcsAccelerometerCoreValues;

declare function bootstrapAccelerometer(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless Accelerometer primitive. A thin, framework-agnostic wrapper around
 * the Generic Sensor API's `Accelerometer` class exposed through the
 * wc-bindable protocol.
 *
 * The platform `Sensor` base class (shared by `Accelerometer` / `Gyroscope` /
 * `Magnetometer` / `AmbientLightSensor`) reports failure through an `'error'`
 * event rather than a rejected promise, so this Core can satisfy never-throw
 * (docs/async-io-node-guidelines.md §3.6) by simply forwarding that event —
 * see docs/sensor-tag-design.md §0. The one place a synchronous
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
 * resolution could race a dispose() — see docs/sensor-tag-design.md §1.5
 * (the same reasoning as NetworkCore, docs/network-tag-design.md §5).
 *
 * Permissions: this Core does not query `navigator.permissions` itself.
 * Compose with `<wcs-permission name="accelerometer">` instead — see
 * docs/sensor-tag-design.md §"2番目の決定: Permissions APIとの合成".
 */
declare class AccelerometerCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _reading;
    private _error;
    private _sensor;
    constructor(target?: EventTarget);
    get x(): number | null;
    get y(): number | null;
    get z(): number | null;
    get error(): WcsAccelerometerErrorDetail | null;
    /** No asynchronous probe to await: start()/stop() are synchronous
     *  (docs/async-io-node-guidelines.md §3.8 is satisfied trivially, mirroring
     *  NetworkCore). */
    get ready(): Promise<void>;
    private _setReading;
    private _setError;
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
    start(frequency?: number): void;
    /** Stop the sensor and detach its listeners. Safe to call when not started. */
    stop(): void;
    /** Lifecycle alias for start(), so the Shell's connectedCallback can drive
     *  this Core the same way as other IO nodes' observe()/dispose() pair. No
     *  asynchronous probe, so the returned promise always resolves immediately. */
    observe(frequency?: number): Promise<void>;
    /** Lifecycle alias for stop(), invoked from the Shell's disconnectedCallback. */
    dispose(): void;
    private _teardownSensor;
    /**
     * Construct the platform `Accelerometer`, guarding both non-support and a
     * synchronous constructor exception. Never calls the raw `new Accelerometer(...)`
     * anywhere else in this class — see docs/sensor-tag-design.md §1.5.
     *
     * API resolution is call-time (docs/async-io-node-guidelines.md §3.7):
     * re-checked on every start(), never cached, so tests can install/remove the
     * global freely and an unsupported environment is always reported correctly.
     */
    private _createSensor;
    private _onReading;
    private _onError;
}

/**
 * `<wcs-accelerometer>` — declarative Generic Sensor API (`Accelerometer`)
 * monitor + start/stop control.
 *
 * Unlike `<wcs-network>` / `<wcs-permission>` (pure monitors), this Shell is a
 * bidirectional node: `start`/`stop` commands (command-token: state → element)
 * alongside the `x`/`y`/`z`/`error` observable surface (event-token: element →
 * state). The `frequency` attribute is the sole configuration input, forwarded
 * to the platform `Accelerometer` constructor's `{ frequency }` option
 * (docs/sensor-tag-design.md §1.2). The getter normalizes it: a non-finite or
 * non-positive value (NaN, 0, negative) reads back as `null` — meaning "no
 * frequency specified" — so start() falls back to the platform default rather
 * than forwarding a value the sensor would reject. Any positive finite value is
 * passed through verbatim (no upper-bound clamping — an out-of-range-but-positive
 * rate is still left to the browser/sensor to reject via `error`).
 *
 * Permission handling is intentionally NOT implemented here. Compose with
 * `<wcs-permission name="accelerometer">` instead (see the README's permission
 * example, "Gate on permission, then start", and docs/sensor-tag-design.md).
 */
declare class WcsAccelerometer extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    constructor();
    /**
     * Sampling frequency in Hz. Reads back `null` when unset, blank, or when the
     * attribute does not parse to a positive finite number (NaN, `"0"`, negative)
     * — in every such "no usable value" case the platform default applies.
     *
     * Note the deliberate set/get asymmetry: `set frequency(0)` (or any
     * non-positive/non-finite value) still writes the attribute verbatim for
     * transparency/inspectability, but the getter normalizes it back to `null`.
     * A round-trip through a non-positive value therefore does NOT preserve it —
     * that value carries no valid sampling meaning, so it is treated as "unset"
     * on read. Only positive finite frequencies survive a set→get round-trip.
     */
    get frequency(): number | null;
    set frequency(value: number | null | undefined);
    get x(): number | null;
    get y(): number | null;
    get z(): number | null;
    get error(): WcsAccelerometerErrorDetail | null;
    get connectedCallbackPromise(): Promise<void>;
    start(): void;
    stop(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { AccelerometerCore, WcsAccelerometer, bootstrapAccelerometer, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsAccelerometerCoreValues, WcsAccelerometerErrorDetail, WcsAccelerometerReading, WcsAccelerometerValues };

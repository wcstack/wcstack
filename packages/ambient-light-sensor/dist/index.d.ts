/** operation error の phase(taxonomy)。 */
type WcsIoErrorPhase = "probe" | "start" | "execute" | "decode" | "commit" | "dispose";
/** serializable な error info(non-cloneable な cause とは分離。DevTools / remote へは info のみ)。 */
interface WcsIoErrorInfo {
    readonly code: string;
    readonly phase: WcsIoErrorPhase;
    readonly recoverable: boolean;
    readonly capabilityId?: string;
    readonly message: string;
}

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
    /** Integer protocol version. All versions >= 1 are core-compatible. */
    readonly version: number;
    readonly properties: readonly IWcBindableProperty[];
    readonly inputs?: readonly IWcBindableInput[];
    readonly commands?: readonly IWcBindableCommand[];
}

interface ITagNames {
    readonly ambientLightSensor: string;
}
interface IWritableTagNames {
    ambientLightSensor?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * A single `reading` sample from the AmbientLightSensor sensor: ambient light
 * level in lux. Unlike Accelerometer/Gyroscope/Magnetometer (x/y/z axes),
 * AmbientLightSensor reports a single scalar (docs/sensor-tag-design.md §2).
 */
interface WcsAmbientLightSensorReading {
    illuminance: number | null;
}
/**
 * Error detail published on the `wcs-ambient-light-sensor:error` event. Mirrors the
 * Generic Sensor API's `SensorErrorEvent.error` (a `DOMException`-like value)
 * flattened to a plain object, plus the synthetic `"unsupported"` name used
 * when the global `AmbientLightSensor` constructor is absent.
 */
interface WcsAmbientLightSensorErrorDetail {
    error: string;
    message: string;
}
/**
 * Value types for AmbientLightSensorCore (headless) — the observable state
 * properties. Use with `bind()` from a wc-bindable binding core for
 * compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new AmbientLightSensorCore();
 * bind(core, (name: keyof WcsAmbientLightSensorCoreValues, value) => { ... });
 * ```
 */
interface WcsAmbientLightSensorCoreValues extends WcsAmbientLightSensorReading {
    error: WcsAmbientLightSensorErrorDetail | null;
    /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
    errorInfo: WcsIoErrorInfo | null;
}
/**
 * Value types for the Shell (`<wcs-ambient-light-sensor>`) — identical observable
 * surface to the Core, plus the `frequency` attribute-backed input.
 */
type WcsAmbientLightSensorValues = WcsAmbientLightSensorCoreValues;

declare function bootstrapAmbientLightSensor(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless AmbientLightSensor primitive. A thin, framework-agnostic wrapper around
 * the Generic Sensor API's `AmbientLightSensor` class exposed through the
 * wc-bindable protocol.
 *
 * The platform `Sensor` base class (shared by `Accelerometer` / `Gyroscope` /
 * `Magnetometer` / `AmbientLightSensor`) reports failure through an `'error'`
 * event rather than a rejected promise, so this Core can satisfy never-throw
 * (docs/async-io-node-guidelines.md §3.6) by simply forwarding that event —
 * see docs/sensor-tag-design.md §0. The one place a synchronous
 * exception *can* still escape the platform API is the `AmbientLightSensor`
 * constructor itself (e.g. `SecurityError` on permission denial or a
 * feature-policy block); `_createSensor()` wraps that single call in
 * try/catch, mirroring FetchCore's `_doFetch` try/catch around
 * `globalThis.fetch` (packages/fetch/src/core/FetchCore.ts).
 *
 * `illuminance` is a single getter derived from the `wcs-ambient-light-sensor:reading`
 * event (unlike Accelerometer/Gyroscope/Magnetometer's x/y/z, this sensor
 * reports one scalar — docs/sensor-tag-design.md §2). `reading`
 * is an event-like signal (a fresh sample every time, not a settled state) and
 * is therefore deliberately NOT same-value guarded — every sample dispatches.
 * `error` is state-like (denial / unsupported does not change from tick to
 * tick) and IS same-value guarded, and is published on its own
 * `wcs-ambient-light-sensor:error` event, independent of `reading`.
 *
 * No `_gen` generation guard: start()/stop() are a synchronous
 * subscribe/unsubscribe toggle with no asynchronous probe whose stale
 * resolution could race a dispose() — see docs/sensor-tag-design.md §1.5
 * (the same reasoning as NetworkCore, docs/network-tag-design.md §5).
 *
 * Permissions: this Core does not query `navigator.permissions` itself.
 * Compose with `<wcs-permission name="ambient-light-sensor">` instead — see
 * docs/sensor-tag-design.md §"2番目の決定: Permissions APIとの合成".
 */
declare class AmbientLightSensorCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _reading;
    private _error;
    private _errorInfo;
    private _sensor;
    constructor(target?: EventTarget);
    get illuminance(): number | null;
    get error(): WcsAmbientLightSensorErrorDetail | null;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-ambient-light-sensor:error-info-changed`), derived from `error`; the existing
     * `error` property/event are unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    /** No asynchronous probe to await: start()/stop() are synchronous
     *  (docs/async-io-node-guidelines.md §3.8 is satisfied trivially, mirroring
     *  NetworkCore). */
    get ready(): Promise<void>;
    private _setReading;
    private _setError;
    private _commitErrorInfo;
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
     * Construct the platform `AmbientLightSensor`, guarding both non-support and a
     * synchronous constructor exception. Never calls the raw `new AmbientLightSensor(...)`
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
 * `<wcs-ambient-light-sensor>` — declarative Generic Sensor API (`AmbientLightSensor`)
 * monitor + start/stop control.
 *
 * Unlike `<wcs-network>` / `<wcs-permission>` (pure monitors), this Shell is a
 * bidirectional node: `start`/`stop` commands (command-token: state → element)
 * alongside the `illuminance`/`error` observable surface (event-token: element →
 * state). The `frequency` attribute is the sole configuration input, forwarded
 * to the platform `AmbientLightSensor` constructor's `{ frequency }` option
 * (docs/sensor-tag-design.md §1.2). The getter normalizes it: a non-finite or
 * non-positive value (NaN, 0, negative) reads back as `null` — meaning "no
 * frequency specified" — so start() falls back to the platform default rather
 * than forwarding a value the sensor would reject. Any positive finite value is
 * passed through verbatim (no upper-bound clamping — an out-of-range-but-positive
 * rate is still left to the browser/sensor to reject via `error`).
 *
 * Permission handling is intentionally NOT implemented here. Compose with
 * `<wcs-permission name="ambient-light-sensor">` instead (see the README's permission
 * example, "Gate on permission, then start", and docs/sensor-tag-design.md).
 */
declare class WcsAmbientLightSensor extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
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
    get illuminance(): number | null;
    get error(): WcsAmbientLightSensorErrorDetail | null;
    get errorInfo(): WcsIoErrorInfo | null;
    get connectedCallbackPromise(): Promise<void>;
    start(): void;
    stop(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

/**
 * ambientLightSensorCapabilities.ts
 *
 * AmbientLightSensor node 固有の error code(taxonomy)と derivation。汎用の error info
 * 型は `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。sensor は監視系(継続 subscribe/unsubscribe)で競合する operation を持た
 * ないため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 *
 * sensor family(accelerometer / gyroscope / magnetometer / ambient-light-sensor)は
 * error 面が構造同一(`{ error: <name>, message }`、`.error` が Error.name / "unsupported"
 * / "error" fallback)なので、taxonomy も 4 兄弟で一致させる。
 */

/** 安定した ambient-light-sensor error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_AMBIENT_LIGHT_SENSOR_ERROR_CODE: {
    /** Sensor API 非対応(`globalThis.AmbientLightSensor` 不在)。 */
    readonly CapabilityMissing: "capability-missing";
    /** `SecurityError` / `NotAllowedError` — 権限拒否・feature-policy ブロック。 */
    readonly NotAllowed: "not-allowed";
    /** `NotReadableError` — センサーハードウェアを読めない。 */
    readonly NotReadable: "not-readable";
    /** その他の SensorErrorEvent / 想定外の失敗。 */
    readonly SensorError: "sensor-error";
};

export { AmbientLightSensorCore, WCS_AMBIENT_LIGHT_SENSOR_ERROR_CODE, WcsAmbientLightSensor, bootstrapAmbientLightSensor, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsAmbientLightSensorCoreValues, WcsAmbientLightSensorErrorDetail, WcsAmbientLightSensorReading, WcsAmbientLightSensorValues, WcsIoErrorInfo, WcsIoErrorPhase };

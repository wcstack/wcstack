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

/**
 * Observation semantics of a `properties` entry.
 *
 *   "state"  — current value. A snapshot may cache it, and equality-based dedupe is safe.
 *   "event"  — occurrence. Repeated identical payloads are distinct occurrences; never dedupe.
 *   "handle" — live / opaque resource with its own lifecycle (e.g. MediaStream). Not
 *              snapshot-safe and not necessarily serializable; consumers need an explicit
 *              ref / callback surface rather than a value slot.
 */
type WcBindableSemantics = "state" | "event" | "handle";
interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
    /**
     * Optional, additive, forward-compatible. An absent value means **unspecified**, NOT
     * "state": a reader that finds no `semantics` MUST keep the behavior it had before this
     * field existed (deliver the update as-is; do not start deduping, caching or serializing
     * on assumption). Only an explicit value licenses a reader to change its handling.
     */
    readonly semantics?: WcBindableSemantics;
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
 * `Accelerometer`, not `LinearAccelerationSensor`). On the `devicemotion`
 * fallback it is the event's `accelerationIncludingGravity`.
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
 * when the browser has neither the global `Accelerometer` constructor nor
 * `DeviceMotionEvent`.
 */
interface WcsAccelerometerErrorDetail {
    error: string;
    message: string;
}
/**
 * What the browser answered to `requestPermission()`. `"unknown"` until it
 * answers: nothing was asked yet, or the browser refused to ask (iOS, outside a
 * tap). The same 3-value vocabulary as `<wcs-tilt>` — not the Permissions API's
 * state, which `<wcs-permission name="accelerometer">` reports.
 */
type WcsAccelerometerPermissionState = "granted" | "denied" | "unknown";
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
    permissionState: WcsAccelerometerPermissionState;
    error: WcsAccelerometerErrorDetail | null;
    /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
    errorInfo: WcsIoErrorInfo | null;
    /** This page can use the sensor (an API is there and the page is not forbidden to use it). */
    supported: boolean;
}
/**
 * Value types for the Shell (`<wcs-accelerometer>`) — identical observable
 * surface to the Core, plus the `frequency` attribute-backed input.
 */
type WcsAccelerometerValues = WcsAccelerometerCoreValues;

declare function bootstrapAccelerometer(userConfig?: IWritableConfig, registry?: CustomElementRegistry): void;

declare function getConfig(): IConfig;

/**
 * Headless Accelerometer primitive. A thin, framework-agnostic wrapper around
 * the Generic Sensor API's `Accelerometer` class exposed through the
 * wc-bindable protocol — and, where the browser has no such class (iPhone and
 * iPad Safari, Firefox on Android), around `window`'s `devicemotion` event,
 * whose `accelerationIncludingGravity` is the same quantity in the same unit.
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
 * `requestPermission()` does await the browser's answer, but what it writes
 * afterwards is a plain `permissionState` / `error` value with no subscription
 * or resource to race — the same benign shape as `<wcs-tilt>`'s
 * (docs/timing-and-firing-contract.md §8.2).
 *
 * Permissions: this Core does not query `navigator.permissions` itself.
 * Compose with `<wcs-permission name="accelerometer">` for the Generic Sensor's
 * own permission — see docs/sensor-tag-design.md §"2番目の決定: Permissions APIとの合成".
 * `permissionState` here is only the answer to iOS's `DeviceMotionEvent.requestPermission()`,
 * which no Permissions API entry reports.
 */
declare class AccelerometerCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _reading;
    private _permissionState;
    private _error;
    private _errorInfo;
    private _supportedPublished;
    private _sensor;
    private _motion;
    private _motionGap;
    private _motionLast;
    constructor(target?: EventTarget);
    get x(): number | null;
    get y(): number | null;
    get z(): number | null;
    get permissionState(): WcsAccelerometerPermissionState;
    get error(): WcsAccelerometerErrorDetail | null;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-accelerometer:error-info-changed`), derived from `error`; the existing
     * `error` property/event are unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    /**
     * Whether this page can use the sensor: the `Accelerometer` class or
     * `DeviceMotionEvent` is there, and neither an insecure context nor a
     * Permissions-Policy that forbids `accelerometer` is in the way. Read at call
     * time, never cached. It cannot say whether the device has a sensor.
     */
    get supported(): boolean;
    /** No asynchronous probe to await: start()/stop() are synchronous
     *  (docs/async-io-node-guidelines.md §3.8 is satisfied trivially, mirroring
     *  NetworkCore). */
    get ready(): Promise<void>;
    private _setReading;
    private _setPermissionState;
    private _setError;
    private _commitErrorInfo;
    /**
     * Dispatch `wcs-accelerometer:supported-changed` when `supported` differs
     * from the value last dispatched (false before the first). The Shell calls it
     * on connect, so a listener other than a binding — which reads the property
     * when it binds — learns the value too.
     */
    publishSupported(): void;
    /**
     * Ask for what start() needs, where there is a question to ask. Only iOS
     * Safari has one, and only on the `devicemotion` fallback: the static,
     * tap-gated `DeviceMotionEvent.requestPermission()`. Everywhere else the
     * sensor can be started (the Generic Sensor class, or `devicemotion` without
     * the gate) this resolves to `"granted"` at once without asking anything, so
     * a page writes one `requestPermission()` → `start()` flow for every browser.
     * The Generic Sensor's own permission is not asked here: `start()` reports a
     * refusal through `error`, and `<wcs-permission name="accelerometer">` watches it.
     *
     * `permissionState` changes only when the browser answers. A rejection is
     * not an answer: iOS rejects (`NotAllowedError`) when the call does not come
     * from a tap, without showing the question. It leaves `permissionState` as it
     * was, lands in `error` (never-throw, §3.6) and resolves to the unchanged
     * state — as does a browser with neither API (`unsupported`). An answer
     * clears an `error` left by an earlier attempt, as in `<wcs-tilt>`.
     */
    requestPermission(): Promise<WcsAccelerometerPermissionState>;
    /**
     * Start the sensor at the given `frequency` (Hz), or the platform default
     * when omitted. Idempotent while already started: a redundant start() does
     * not construct a second sensor instance (which would leak the first).
     * Restart with a different frequency via stop() + start().
     *
     * Where the browser has no `Accelerometer` class but has `devicemotion`, it
     * subscribes to that instead; which of the two is decided at each start().
     * `devicemotion` has its own rate, so there `frequency` only thins: a reading
     * arriving sooner than `1000 / frequency` ms after the last published one is
     * dropped.
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
    private _api;
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
    private _onMotion;
    private _onError;
}

/**
 * `<wcs-accelerometer>` — declarative Generic Sensor API (`Accelerometer`)
 * monitor + start/stop control, on `devicemotion` where the browser has no
 * such class (iPhone and iPad Safari, Firefox on Android).
 *
 * Unlike `<wcs-network>` / `<wcs-permission>` (pure monitors), this Shell is a
 * bidirectional node: `start`/`stop` commands (command-token: state → element)
 * alongside the `x`/`y`/`z`/`error` observable surface (event-token: element →
 * state). The `frequency` attribute is the sole configuration input, forwarded
 * to the platform `Accelerometer` constructor's `{ frequency }` option
 * (docs/sensor-tag-design.md §1.2). The getter normalizes it: a non-finite or
 * non-positive value (NaN, 0, negative) reads back as `null` — meaning "no
 * frequency specified" — so start() falls back to the platform default rather
 * than forwarding a value the sensor would reject, and says so once
 * (`[wcs/frequency-invalid]`). Any positive finite value is passed through
 * verbatim (no upper-bound clamping — the browser caps a rate above what it
 * allows).
 *
 * The Generic Sensor's permission is intentionally NOT tracked here. Compose
 * with `<wcs-permission name="accelerometer">` instead (see the README's
 * permission example, "Gate on permission, then start", and
 * docs/sensor-tag-design.md). `requestPermission` / `permissionState` are for
 * the one question no Permissions API entry reports: iOS's
 * `DeviceMotionEvent.requestPermission()`.
 */
declare class WcsAccelerometer extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    private _internals;
    private _frequencyWarned;
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
    get x(): number | null;
    get y(): number | null;
    get z(): number | null;
    get permissionState(): WcsAccelerometerPermissionState;
    get error(): WcsAccelerometerErrorDetail | null;
    get errorInfo(): WcsIoErrorInfo | null;
    get supported(): boolean;
    get connectedCallbackPromise(): Promise<void>;
    requestPermission(): Promise<WcsAccelerometerPermissionState>;
    start(): void;
    stop(): void;
    private _warnUnusableFrequency;
    connectedCallback(): void;
    connectedMoveCallback(): void;
    disconnectedCallback(): void;
}

/**
 * accelerometerCapabilities.ts
 *
 * Accelerometer node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。sensor は監視系(継続 subscribe/unsubscribe)で競合する operation を持た
 * ないため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 *
 * sensor family(accelerometer / gyroscope / magnetometer / ambient-light-sensor)は
 * error 面が構造同一(`{ error: <name>, message }`、`.error` が Error.name / "unsupported"
 * / "error" fallback)なので、taxonomy も 4 兄弟で一致させる。
 */

/** 安定した accelerometer error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_ACCELEROMETER_ERROR_CODE: {
    /** Sensor API 非対応(`globalThis.Accelerometer` も `DeviceMotionEvent` も不在)。 */
    readonly CapabilityMissing: "capability-missing";
    /** `SecurityError` / `NotAllowedError` — 権限拒否・feature-policy ブロック、または質問を出せなかった `requestPermission()`。 */
    readonly NotAllowed: "not-allowed";
    /** `NotReadableError` — センサーハードウェアを読めない。 */
    readonly NotReadable: "not-readable";
    /** その他の SensorErrorEvent / 想定外の失敗。 */
    readonly SensorError: "sensor-error";
};

declare global {
    interface HTMLElementTagNameMap {
        "wcs-accelerometer": WcsAccelerometer;
    }
}

export { AccelerometerCore, WCS_ACCELEROMETER_ERROR_CODE, WcsAccelerometer, bootstrapAccelerometer, getConfig };
export type { IWritableConfig, IWritableTagNames, WcsAccelerometerCoreValues, WcsAccelerometerErrorDetail, WcsAccelerometerPermissionState, WcsAccelerometerReading, WcsAccelerometerValues, WcsIoErrorInfo, WcsIoErrorPhase };

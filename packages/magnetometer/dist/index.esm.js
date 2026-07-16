const _config = {
    tagNames: {
        magnetometer: "wcs-magnetometer",
    },
};
function deepFreeze(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
        deepFreeze(obj[key]);
    }
    return obj;
}
function deepClone(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    const clone = {};
    for (const key of Object.keys(obj)) {
        clone[key] = deepClone(obj[key]);
    }
    return clone;
}
let frozenConfig = null;
const config = _config;
function getConfig() {
    if (!frozenConfig) {
        frozenConfig = deepFreeze(deepClone(_config));
    }
    return frozenConfig;
}
function setConfig(partialConfig) {
    if (partialConfig.tagNames) {
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    frozenConfig = null;
}

/**
 * magnetometerCapabilities.ts
 *
 * Magnetometer node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。sensor は監視系(継続 subscribe/unsubscribe)で競合する operation を持た
 * ないため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 *
 * sensor family(accelerometer / gyroscope / magnetometer / ambient-light-sensor)は
 * error 面が構造同一(`{ error: <name>, message }`、`.error` が Error.name / "unsupported"
 * / "error" fallback)なので、taxonomy も 4 兄弟で一致させる。
 */
/** 安定した magnetometer error code(taxonomy)。値は公開キーとして固定。 */
const WCS_MAGNETOMETER_ERROR_CODE = {
    /** Sensor API 非対応(`globalThis.Magnetometer` 不在)。 */
    CapabilityMissing: "capability-missing",
    /** `SecurityError` / `NotAllowedError` — 権限拒否・feature-policy ブロック。 */
    NotAllowed: "not-allowed",
    /** `NotReadableError` — センサーハードウェアを読めない。 */
    NotReadable: "not-readable",
    /** その他の SensorErrorEvent / 想定外の失敗。 */
    SensorError: "sensor-error",
};
/**
 * sensor の失敗を serializable な error taxonomy に写す。`name` は error detail の
 * `.error`(`Error.name` / "unsupported" / "error" fallback)。
 *
 * - "unsupported" は開始前の能力欠如 → phase="probe" / capability-missing。
 * - `SecurityError` / `NotAllowedError` は sensor 構築時の権限拒否 → phase="start" /
 *   not-allowed。いずれも retry で回復しない(recoverable=false)。
 * - `NotReadableError` は稼働中のハードウェア読取失敗 → phase="execute" / not-readable。
 * - それ以外(SensorErrorEvent の他 name / "error" fallback)は phase="execute" /
 *   sensor-error。
 */
function deriveMagnetometerErrorInfo(name, message) {
    if (name === "unsupported") {
        return { code: WCS_MAGNETOMETER_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
    }
    if (name === "SecurityError" || name === "NotAllowedError") {
        return { code: WCS_MAGNETOMETER_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message };
    }
    if (name === "NotReadableError") {
        return { code: WCS_MAGNETOMETER_ERROR_CODE.NotReadable, phase: "execute", recoverable: false, message };
    }
    return { code: WCS_MAGNETOMETER_ERROR_CODE.SensorError, phase: "execute", recoverable: false, message };
}

const NULL_READING = Object.freeze({ x: null, y: null, z: null });
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
class MagnetometerCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "x", event: "wcs-magnetometer:reading", getter: (e) => e.detail.x },
            { name: "y", event: "wcs-magnetometer:reading", getter: (e) => e.detail.y },
            { name: "z", event: "wcs-magnetometer:reading", getter: (e) => e.detail.z },
            { name: "error", event: "wcs-magnetometer:error" },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output derived from `error.error` (the Error.name /
            // "unsupported"); the existing `error` property/event are unchanged. Fires
            // wcs-magnetometer:error-info-changed. No lane — the sensor is a monitor.
            { name: "errorInfo", event: "wcs-magnetometer:error-info-changed" },
        ],
        commands: [{ name: "start" }, { name: "stop" }],
    };
    _target;
    _reading = NULL_READING;
    _error = null;
    _errorInfo = null;
    // The live sensor instance while started (null otherwise), kept so stop()
    // can remove its listeners precisely and so start() can detect "already
    // started" without a separate boolean (docs/async-io-node-guidelines.md
    // §3.5 idempotency).
    _sensor = null;
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get x() {
        return this._reading.x;
    }
    get y() {
        return this._reading.y;
    }
    get z() {
        return this._reading.z;
    }
    get error() {
        return this._error;
    }
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-magnetometer:error-info-changed`), derived from `error`; the existing
     * `error` property/event are unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
    }
    /** No asynchronous probe to await: start()/stop() are synchronous
     *  (docs/async-io-node-guidelines.md §3.8 is satisfied trivially, mirroring
     *  NetworkCore). */
    get ready() {
        return Promise.resolve();
    }
    // --- State setters ---
    // Deliberately NOT same-value guarded: a `reading` is a fresh sample, not a
    // settled state, so it must dispatch every time even when the values happen
    // to repeat (docs/sensor-tag-design.md §1.1).
    _setReading(reading) {
        this._reading = reading;
        this._target.dispatchEvent(new CustomEvent("wcs-magnetometer:reading", {
            detail: reading,
            bubbles: true,
        }));
    }
    _setError(error) {
        // Same-value guard (by error name + message): error is state-like, unlike
        // reading — a repeated identical error (same name and message) must not
        // redispatch. Note `error` is also STICKY: nothing calls _setError(null),
        // so a successful (re)start does not clear a prior failure — the monitoring
        // sensor family deliberately keeps the last observed error (docs/sensor-tag-design.md §1.5).
        if (this._error?.error === error?.error && this._error?.message === error?.message)
            return;
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
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-magnetometer:error-info-changed", {
            detail: info,
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
    start(frequency) {
        if (this._sensor)
            return;
        const sensor = this._createSensor(frequency);
        if (!sensor)
            return;
        sensor.addEventListener("reading", this._onReading);
        sensor.addEventListener("error", this._onError);
        this._sensor = sensor;
        try {
            sensor.start();
        }
        catch (e) {
            // Defensive: the platform contract says start()/stop() do not throw
            // (failures surface via the 'error' event), but never-throw is a hard
            // requirement here, so guard against a non-conformant implementation
            // too.
            this._teardownSensor();
            this._setError({ error: e?.name ?? "error", message: e?.message ?? String(e) });
        }
    }
    /** Stop the sensor and detach its listeners. Safe to call when not started. */
    stop() {
        if (!this._sensor)
            return;
        try {
            this._sensor.stop();
        }
        catch {
            // Never-throw defensive guard, symmetric with start(). Teardown below
            // still runs so listeners are detached regardless.
        }
        this._teardownSensor();
    }
    /** Lifecycle alias for start(), so the Shell's connectedCallback can drive
     *  this Core the same way as other IO nodes' observe()/dispose() pair. No
     *  asynchronous probe, so the returned promise always resolves immediately. */
    observe(frequency) {
        this.start(frequency);
        return this.ready;
    }
    /** Lifecycle alias for stop(), invoked from the Shell's disconnectedCallback. */
    dispose() {
        this.stop();
    }
    // --- Internal ---
    // Both call sites (start()'s catch, stop()) only ever invoke this once
    // `this._sensor` is already known non-null, so there is no null-guard here
    // (nothing to defend against).
    _teardownSensor() {
        this._sensor.removeEventListener("reading", this._onReading);
        this._sensor.removeEventListener("error", this._onError);
        this._sensor = null;
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
    _createSensor(frequency) {
        const Ctor = globalThis.Magnetometer;
        if (typeof Ctor !== "function") {
            this._setError({ error: "unsupported", message: "Magnetometer is not supported" });
            return null;
        }
        try {
            return new Ctor(frequency !== undefined ? { frequency } : undefined);
        }
        catch (e) {
            // SecurityError (permission denial, feature-policy block) or any other
            // synchronous construction failure. Mirrors the FetchCore._doFetch
            // try/catch structure (packages/fetch/src/core/FetchCore.ts) — a
            // synchronous constructor call here instead of an awaited fetch().
            this._setError({ error: e?.name ?? "error", message: e?.message ?? String(e) });
            return null;
        }
    }
    _onReading = (event) => {
        const sensor = event.target;
        this._setReading({ x: sensor.x, y: sensor.y, z: sensor.z });
    };
    _onError = (event) => {
        const err = event.error;
        // Fallback is a meaningful constant, NOT String(err): a SensorErrorEvent
        // without an `error` field would otherwise stringify `undefined` into the
        // literal message "undefined" (aligned across the sensor family).
        this._setError({ error: err?.name ?? "error", message: err?.message ?? "Sensor error" });
    };
}

/**
 * `<wcs-magnetometer>` — declarative Generic Sensor API (`Magnetometer`)
 * monitor + start/stop control.
 *
 * Unlike `<wcs-network>` / `<wcs-permission>` (pure monitors), this Shell is a
 * bidirectional node: `start`/`stop` commands (command-token: state → element)
 * alongside the `x`/`y`/`z`/`error` observable surface (event-token: element →
 * state). The `frequency` attribute is the sole configuration input, forwarded
 * to the platform `Magnetometer` constructor's `{ frequency }` option
 * (docs/sensor-tag-design.md §1.2). The getter normalizes it: a non-finite or
 * non-positive value (NaN, 0, negative) reads back as `null` — meaning "no
 * frequency specified" — so start() falls back to the platform default rather
 * than forwarding a value the sensor would reject. Any positive finite value is
 * passed through verbatim (no upper-bound clamping — an out-of-range-but-positive
 * rate is still left to the browser/sensor to reject via `error`).
 *
 * Permission handling is intentionally NOT implemented here. Compose with
 * `<wcs-permission name="magnetometer">` instead (see the README's permission
 * example, "Gate on permission, then start", and docs/sensor-tag-design.md).
 */
class WcsMagnetometer extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...MagnetometerCore.wcBindable,
        inputs: [{ name: "frequency" }],
        // Core の commands をそのまま継承（単一情報源）。
        commands: MagnetometerCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new MagnetometerCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-magnetometer:error": (d) => ({ error: d != null }),
        });
    }
    // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
    // wc-bindable (not a bind target); see README "CSS styling with :state()".
    // MUST NOT return the live CustomStateSet (that would let callers write
    // states from outside, defeating the point of :state() being read-only).
    get debugStates() {
        return this._internals ? [...this._internals.states] : [];
    }
    _initInternals() {
        // never-throw (docs/async-io-node-guidelines.md §3.6): attachInternals is
        // absent in happy-dom / older environments, and pre-125 Chromium rejects
        // non-dashed state names from states.add() (probed and discarded here).
        // Either case silently disables reflection — the component still works,
        // it just doesn't expose :state() selectors.
        try {
            if (typeof this.attachInternals !== "function")
                return null;
            const internals = this.attachInternals();
            internals.states.add("wcs-probe");
            internals.states.delete("wcs-probe");
            return internals;
        }
        catch {
            return null;
        }
    }
    _wireStates(map) {
        if (this._internals === null)
            return;
        const states = this._internals.states;
        for (const [event, toStates] of Object.entries(map)) {
            this.addEventListener(event, (e) => {
                const debug = this.hasAttribute("debug-states");
                for (const [name, on] of Object.entries(toStates(e.detail))) {
                    try {
                        if (on) {
                            states.add(name);
                        }
                        else {
                            states.delete(name);
                        }
                    }
                    catch { /* never-throw */ }
                    if (debug)
                        this.toggleAttribute(`data-wcs-state-${name}`, on);
                }
            });
        }
    }
    // --- Attribute accessors ---
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
     *
     * This value is read only at `start()` time. There is no
     * `attributeChangedCallback`, and `MagnetometerCore.start()` is idempotent
     * while already started (a redundant call is a no-op), so setting
     * `frequency` (attribute or property) on an already-running sensor has no
     * effect until the caller `stop()`s and `start()`s again (see the README's
     * "Notes & limitations").
     */
    get frequency() {
        const attr = this.getAttribute("frequency");
        if (attr === null || attr.trim() === "")
            return null;
        const parsed = Number(attr);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    set frequency(value) {
        if (value === null || value === undefined) {
            this.removeAttribute("frequency");
        }
        else {
            this.setAttribute("frequency", String(value));
        }
    }
    // --- Core delegated getters ---
    get x() {
        return this._core.x;
    }
    get y() {
        return this._core.y;
    }
    get z() {
        return this._core.z;
    }
    get error() {
        return this._core.error;
    }
    get errorInfo() {
        return this._core.errorInfo;
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // --- Commands ---
    start() {
        this._core.start(this.frequency ?? undefined);
    }
    stop() {
        this._core.stop();
    }
    // --- Lifecycle ---
    // Deliberately does NOT auto-start the sensor on connect. Unlike
    // Geolocation (whose default phase acquires a fix immediately unless
    // `manual` is set), Magnetometer has no such "connect implies observing"
    // precedent in the design doc (docs/sensor-tag-design.md §1.3):
    // start/stop are the only commands, so connecting the element merely makes
    // it inert until a command-token `start` (or the `start()` method) is
    // invoked. This also keeps behavior predictable when composed with
    // `<wcs-permission name="magnetometer">`: the caller decides when to start,
    // typically gated on `granted`.
    connectedCallback() {
        this.style.display = "none";
        // No asynchronous probe to await (docs/async-io-node-guidelines.md §3.8);
        // kept for SSR uniformity with other IO nodes.
        this._connectedCallbackPromise = this._core.ready;
    }
    disconnectedCallback() {
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.magnetometer)) {
        customElements.define(config.tagNames.magnetometer, WcsMagnetometer);
    }
}

function bootstrapMagnetometer(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { MagnetometerCore, WCS_MAGNETOMETER_ERROR_CODE, WcsMagnetometer, bootstrapMagnetometer, getConfig };
//# sourceMappingURL=index.esm.js.map

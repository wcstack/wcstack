const _config = {
    tagNames: {
        ambientLightSensor: "wcs-ambient-light-sensor",
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

const NULL_READING = Object.freeze({ illuminance: null });
/**
 * Headless AmbientLightSensor primitive. A thin, framework-agnostic wrapper around
 * the Generic Sensor API's `AmbientLightSensor` class exposed through the
 * wc-bindable protocol.
 *
 * The platform `Sensor` base class (shared by `AmbientLightSensor` / `Gyroscope` /
 * `Magnetometer` / `AmbientLightSensor`) reports failure through an `'error'`
 * event rather than a rejected promise, so this Core can satisfy never-throw
 * (docs/async-io-node-guidelines.md §3.6) by simply forwarding that event —
 * see docs/ambient-light-sensor-tag-design.md §0. The one place a synchronous
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
 * resolution could race a dispose() — see docs/ambient-light-sensor-tag-design.md §1.5
 * (the same reasoning as NetworkCore, docs/network-tag-design.md §5).
 *
 * Permissions: this Core does not query `navigator.permissions` itself.
 * Compose with `<wcs-permission name="ambient-light-sensor">` instead — see
 * docs/ambient-light-sensor-tag-design.md §"Permissions API連携".
 */
class AmbientLightSensorCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "illuminance", event: "wcs-ambient-light-sensor:reading", getter: (e) => e.detail.illuminance },
            { name: "error", event: "wcs-ambient-light-sensor:error" },
        ],
        commands: [{ name: "start" }, { name: "stop" }],
    };
    _target;
    _reading = NULL_READING;
    _error = null;
    // The live sensor instance while started (null otherwise), kept so stop()
    // can remove its listeners precisely and so start() can detect "already
    // started" without a separate boolean (§3.5 idempotency).
    _sensor = null;
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get illuminance() {
        return this._reading.illuminance;
    }
    get error() {
        return this._error;
    }
    /** No asynchronous probe to await: start()/stop() are synchronous (§3.8 is
     *  satisfied trivially, mirroring NetworkCore). */
    get ready() {
        return Promise.resolve();
    }
    // --- State setters ---
    // Deliberately NOT same-value guarded: a `reading` is a fresh sample, not a
    // settled state, so it must dispatch every time even when the values happen
    // to repeat (docs/ambient-light-sensor-tag-design.md §1.1 / §3).
    _setReading(reading) {
        this._reading = reading;
        this._target.dispatchEvent(new CustomEvent("wcs-ambient-light-sensor:reading", {
            detail: reading,
            bubbles: true,
        }));
    }
    _setError(error) {
        // Same-value guard (by error name): error is state-like, unlike reading.
        if (this._error?.error === error?.error && this._error?.message === error?.message)
            return;
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-ambient-light-sensor:error", {
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
     * Construct the platform `AmbientLightSensor`, guarding both non-support and a
     * synchronous constructor exception. Never calls the raw `new AmbientLightSensor(...)`
     * anywhere else in this class — see docs/ambient-light-sensor-tag-design.md §1.5.
     *
     * API resolution is call-time (§3.7): re-checked on every start(), never
     * cached, so tests can install/remove the global freely and an unsupported
     * environment is always reported correctly.
     */
    _createSensor(frequency) {
        const Ctor = globalThis.AmbientLightSensor;
        if (typeof Ctor !== "function") {
            this._setError({ error: "unsupported", message: "AmbientLightSensor is not supported" });
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
        this._setReading({ illuminance: sensor.illuminance });
    };
    _onError = (event) => {
        const err = event.error;
        this._setError({ error: err?.name ?? "error", message: err?.message ?? String(err) });
    };
}

/**
 * `<wcs-ambient-light-sensor>` — declarative Generic Sensor API (`AmbientLightSensor`)
 * monitor + start/stop control.
 *
 * Unlike `<wcs-network>` / `<wcs-permission>` (pure monitors), this Shell is a
 * bidirectional node: `start`/`stop` commands (command-token: state → element)
 * alongside the `illuminance`/`error` observable surface (event-token: element →
 * state). The `frequency` attribute is the sole configuration input, passed
 * straight through to the platform `AmbientLightSensor` constructor's `{ frequency }`
 * option (docs/ambient-light-sensor-tag-design.md §1.2) — no range validation here;
 * an out-of-range value is left to the browser/sensor to reject via `error`.
 *
 * Permission handling is intentionally NOT implemented here. Compose with
 * `<wcs-permission name="ambient-light-sensor">` instead (see README "Composing with
 * wcs-permission" and docs/ambient-light-sensor-tag-design.md).
 */
class WcsAmbientLightSensor extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...AmbientLightSensorCore.wcBindable,
        inputs: [{ name: "frequency" }],
        // Core の commands をそのまま継承（単一情報源）。
        commands: AmbientLightSensorCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    constructor() {
        super();
        this._core = new AmbientLightSensorCore(this);
    }
    // --- Attribute accessors ---
    /** Sampling frequency in Hz. `null` when unset (platform default applies). */
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
    get illuminance() {
        return this._core.illuminance;
    }
    get error() {
        return this._core.error;
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
    // `manual` is set), AmbientLightSensor has no such "connect implies observing"
    // precedent in the design doc (docs/ambient-light-sensor-tag-design.md §1.3):
    // start/stop are the only commands, so connecting the element merely makes
    // it inert until a command-token `start` (or the `start()` method) is
    // invoked. This also keeps behavior predictable when composed with
    // `<wcs-permission name="ambient-light-sensor">`: the caller decides when to start,
    // typically gated on `granted`.
    connectedCallback() {
        this.style.display = "none";
        // No asynchronous probe to await (§3.8); kept for SSR uniformity with
        // other IO nodes.
        this._connectedCallbackPromise = this._core.ready;
    }
    disconnectedCallback() {
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.ambientLightSensor)) {
        customElements.define(config.tagNames.ambientLightSensor, WcsAmbientLightSensor);
    }
}

function bootstrapAmbientLightSensor(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { AmbientLightSensorCore, WcsAmbientLightSensor, bootstrapAmbientLightSensor, getConfig };
//# sourceMappingURL=index.esm.js.map

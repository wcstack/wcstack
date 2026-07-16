const _config = {
    tagNames: {
        tilt: "wcs-tilt",
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
 * tiltCapabilities.ts
 *
 * Tilt(Device Orientation)node 固有の error code(taxonomy)と derivation。汎用の
 * error info 型は `./platformCapability.js`(/io-core/ から copy-distribution される
 * 生成ファイル)から import する。tilt は監視系(deviceorientation の subscribe/
 * unsubscribe)で競合する operation を持たないため lane は持たず、error taxonomy
 * (errorInfo)のみを採用する。
 *
 * sensor 4 兄弟(accelerometer / gyroscope / magnetometer / ambient-light-sensor)と
 * 違い、tilt の error 面は **異なる shape** を持つ:
 * - sensor 族の error detail は `{ error: <Error.name>, message }`(name/message は文字列)。
 * - tilt の error detail は `{ error: <生の rejection reason> }`(TiltCore._setError が
 *   `requestPermission()` の catch で `{ error: e }` を渡す。`e` は生の Error/reason)。
 *
 * したがって derive は「wrap された生の値」から name/message を取り出す。また tilt は
 * "unsupported"(capability-missing)経路を **持たない**: `DeviceOrientationEvent` や
 * その `requestPermission` が無い環境では error にせず `"granted"` に倒して error を
 * クリアする(docs/device-orientation-tag-design.md §3)。よって capability-missing の
 * code / branch は生成しない(到達不能・dead code を避ける)。error として _setError に
 * 届くのは iOS の `requestPermission()` reject だけで、その name は実権限拒否なら
 * `NotAllowedError`、gesture 文脈外等なら汎用 `Error` になる。
 */
/** 安定した tilt error code(taxonomy)。値は公開キーとして固定。 */
const WCS_TILT_ERROR_CODE = {
    /** `NotAllowedError` — iOS の Device Orientation 権限拒否。 */
    NotAllowed: "not-allowed",
    /** その他の `requestPermission()` reject(gesture 文脈外 / 想定外の失敗)。 */
    TiltError: "tilt-error",
};
/**
 * tilt の失敗(`_setError` に渡る `{ error: <生の reason> }`)を serializable な error
 * taxonomy に写す。name は wrap された reason の `Error.name`、message はその `.message`
 * (無ければ `String(...)`)。
 *
 * - `NotAllowedError` は iOS の権限拒否 → phase="start" / not-allowed。retry で回復しない。
 * - それ以外(gesture 文脈外の汎用 `Error`、非 Error reason 等)→ phase="execute" /
 *   tilt-error。
 *
 * capability-missing 経路は無い(上のヘッダ参照): 非対応環境は error ではなく
 * `"granted"` へ倒れるため、ここには到達しない。
 */
function deriveTiltErrorInfo(detail) {
    const name = detail.error?.name;
    const message = detail.error?.message ?? String(detail.error);
    if (name === "NotAllowedError") {
        return { code: WCS_TILT_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message };
    }
    return { code: WCS_TILT_ERROR_CODE.TiltError, phase: "execute", recoverable: false, message };
}

const UNSUPPORTED_SNAPSHOT = Object.freeze({
    alpha: null,
    beta: null,
    gamma: null,
    absolute: null,
});
/**
 * Headless Device Orientation primitive. A thin, framework-agnostic wrapper
 * around `window`'s `deviceorientation` event exposed through the wc-bindable
 * protocol.
 *
 * The batch2 sibling of `@wcstack/idle` (docs/device-orientation-tag-design.md).
 * Unlike Idle Detection, there is no matching Permissions API entry for this
 * feature (`navigator.permissions.query` has no "device-orientation" name), so
 * `permissionState` must be tracked **locally** rather than composed with
 * `<wcs-permission>` — the defining asymmetry within batch2.
 *
 * No `_gen` generation guard: subscribing/unsubscribing to `deviceorientation`
 * (start/stop) is fully synchronous, so that path never needs one. This node
 * does have an async probe — `requestPermission()` awaits the static
 * `DeviceOrientationEvent.requestPermission()` — but its post-await write is
 * a benign `permissionState`/`error` value set + dispatch with no
 * subscription/resource management to race, so `_gen` is unneeded there too
 * (docs/device-orientation-tag-design.md §4, corrected after an earlier
 * revision mistakenly reused `@wcstack/network`'s "no async probe at all"
 * rationale).
 */
class TiltCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "alpha", event: "wcs-tilt:change", getter: (e) => e.detail.alpha },
            { name: "beta", event: "wcs-tilt:change", getter: (e) => e.detail.beta },
            { name: "gamma", event: "wcs-tilt:change", getter: (e) => e.detail.gamma },
            { name: "absolute", event: "wcs-tilt:change", getter: (e) => e.detail.absolute },
            { name: "permissionState", event: "wcs-tilt:permission-changed" },
            // never-throw (§3.6): requestPermission() failures land here instead of
            // rejecting/throwing. Mirrors idle (same batch2) and the accelerometer
            // family (batch5) — see docs/io-node-batch-implementation-plan.md.
            { name: "error", event: "wcs-tilt:error" },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output derived from `error.error` (the wrapped rejection's
            // Error.name); the existing `error` property/event are unchanged. Fires
            // wcs-tilt:error-info-changed. No lane — this is a monitor node.
            { name: "errorInfo", event: "wcs-tilt:error-info-changed" },
        ],
        commands: [
            { name: "requestPermission", async: true },
            { name: "start" },
            { name: "stop" },
        ],
    };
    _target;
    _snapshot = UNSUPPORTED_SNAPSHOT;
    _permissionState = "unknown";
    _error = null;
    _errorInfo = null;
    _subscribed = false;
    // SSR (§3.8): never auto-starts on connect, so there is no probe to await —
    // readiness is always immediate.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get ready() {
        return this._ready;
    }
    get alpha() {
        return this._snapshot.alpha;
    }
    get beta() {
        return this._snapshot.beta;
    }
    get gamma() {
        return this._snapshot.gamma;
    }
    get absolute() {
        return this._snapshot.absolute;
    }
    get permissionState() {
        return this._permissionState;
    }
    get error() {
        return this._error;
    }
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-tilt:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
    }
    // Lifecycle (§3.5). observe() is a synchronous no-op: like `<wcs-idle>`,
    // this Core deliberately does NOT auto-start on connect (§6) on platforms
    // that gate deviceorientation behind requestPermission().
    observe() {
        return this._ready;
    }
    dispose() {
        this.stop();
    }
    _deviceOrientationEventCtor() {
        const g = globalThis;
        return typeof g.DeviceOrientationEvent !== "undefined" ? g.DeviceOrientationEvent : undefined;
    }
    _setPermissionState(state) {
        if (this._permissionState === state)
            return;
        this._permissionState = state;
        this._target.dispatchEvent(new CustomEvent("wcs-tilt:permission-changed", {
            detail: state,
            bubbles: true,
        }));
    }
    _setError(error) {
        if (this._error === error)
            return;
        this._error = error;
        // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the
        // wrapped rejection (or null on clear). Fires before the `error` event so an
        // observer binding both sees the classification first, mirroring the io-node
        // family.
        this._commitErrorInfo(error === null ? null : deriveTiltErrorInfo(error));
        this._target.dispatchEvent(new CustomEvent("wcs-tilt:error", {
            detail: error,
            bubbles: true,
        }));
    }
    // Called only from _setError (which already reference-guards on the error
    // object), so errorInfo transitions exactly when error does — no separate
    // guard needed here.
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-tilt:error-info-changed", {
            detail: info,
            bubbles: true,
        }));
    }
    /**
     * Wraps iOS 13+ Safari's static, gesture-gated
     * `DeviceOrientationEvent.requestPermission()`. On platforms without this
     * gate (Android Chrome, desktop) there is nothing to ask, so this resolves
     * to `"granted"` immediately without querying anything — callers can write
     * one `requestPermission()` → `start()` flow that works everywhere
     * (docs/device-orientation-tag-design.md §3).
     *
     * never-throw (§3.6): a gesture-context rejection resolves to `"denied"`
     * and the raw error lands in `error` instead of propagating. Mirrors
     * `<wcs-idle>`'s `requestPermission()` (docs/idle-detection-tag-design.md
     * §4.1) — any settled (non-throwing) outcome supersedes a stale `error`
     * from an earlier attempt.
     */
    async requestPermission() {
        const Ctor = this._deviceOrientationEventCtor();
        if (typeof Ctor?.requestPermission !== "function") {
            this._setError(null);
            this._setPermissionState("granted");
            return "granted";
        }
        try {
            const result = await Ctor.requestPermission();
            const state = result === "granted" ? "granted" : "denied";
            this._setError(null);
            this._setPermissionState(state);
            return state;
        }
        catch (e) {
            // never-throw: a gesture-context rejection resolves to "denied".
            this._setError({ error: e });
            this._setPermissionState("denied");
            return "denied";
        }
    }
    /** Subscribe to `deviceorientation`. Idempotent — a second start() while already subscribed is a no-op. */
    start() {
        if (this._subscribed)
            return;
        this._subscribed = true;
        globalThis.window?.addEventListener("deviceorientation", this._onOrientation);
    }
    /** Unsubscribe from `deviceorientation`. Safe to call when not started. */
    stop() {
        if (!this._subscribed)
            return;
        this._subscribed = false;
        globalThis.window?.removeEventListener("deviceorientation", this._onOrientation);
    }
    _onOrientation = (event) => {
        this._apply({
            alpha: event.alpha,
            beta: event.beta,
            gamma: event.gamma,
            absolute: event.absolute,
        });
    };
    // Same-value guard (§3.3 MUST).
    _apply(next) {
        const prev = this._snapshot;
        if (prev.alpha === next.alpha &&
            prev.beta === next.beta &&
            prev.gamma === next.gamma &&
            prev.absolute === next.absolute) {
            return;
        }
        this._snapshot = next;
        this._target.dispatchEvent(new CustomEvent("wcs-tilt:change", {
            detail: next,
            bubbles: true,
        }));
    }
}

/**
 * `<wcs-tilt>` — declarative Device Orientation API monitor.
 *
 * Named `tilt` (not `orientation`/`device-orientation`) to avoid colliding
 * with `<wcs-screen-orientation>` (docs/device-orientation-tag-design.md §9).
 *
 * Does NOT auto-start on connect, mirroring `<wcs-idle>`: on iOS, subscribing
 * before permission is granted silently receives no events. Callers drive
 * `requestPermission()` → `start()` explicitly.
 */
class WcsTilt extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...TiltCore.wcBindable,
        inputs: [],
        // Core の commands をそのまま継承（単一情報源）。
        commands: TiltCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new TiltCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-tilt:error": (d) => ({ error: d != null }),
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
        // never-throw (async-io-node-guidelines.md §3.6): attachInternals is absent
        // in happy-dom / older environments, and pre-125 Chromium rejects
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
    // --- Core delegated getters ---
    get alpha() {
        return this._core.alpha;
    }
    get beta() {
        return this._core.beta;
    }
    get gamma() {
        return this._core.gamma;
    }
    get absolute() {
        return this._core.absolute;
    }
    get permissionState() {
        return this._core.permissionState;
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
    // --- Commands (delegated to Core) ---
    requestPermission() {
        return this._core.requestPermission();
    }
    start() {
        this._core.start();
    }
    stop() {
        this._core.stop();
    }
    // --- Lifecycle ---
    connectedCallback() {
        this.style.display = "none";
        this._connectedCallbackPromise = this._core.observe();
    }
    disconnectedCallback() {
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.tilt)) {
        customElements.define(config.tagNames.tilt, WcsTilt);
    }
}

function bootstrapTilt(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { TiltCore, WCS_TILT_ERROR_CODE, WcsTilt, bootstrapTilt, getConfig };
//# sourceMappingURL=index.esm.js.map

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
/** A misspelt option would otherwise do nothing: `bootstrapTilt` refuses it. */
function invalid(key) {
    throw new Error(`[@wcstack/tilt] bootstrapTilt: "${key}" is not one of its options, or not of the option's type.`);
}
/**
 * Applies the options given; an undefined value is left out. An option this package does not
 * have, a value of another type than its default (null, or an array for an object, included) or
 * a tag name it does not define throws, and then nothing is applied.
 */
function setConfig(partialConfig) {
    const options = _config;
    const tags = _config.tagNames;
    const given = Object.entries(partialConfig).filter(([, value]) => value !== undefined);
    const givenTags = Object.entries(partialConfig.tagNames ?? {}).filter(([, tag]) => tag !== undefined);
    for (const [key, value] of given) {
        const current = options[key];
        if (!Object.hasOwn(options, key) || value === null || typeof value !== typeof current || Array.isArray(value) !== Array.isArray(current)) {
            invalid(key);
        }
    }
    for (const [name, tag] of givenTags) {
        if (!Object.hasOwn(tags, name) || typeof tag !== "string")
            invalid(`tagNames.${name}`);
    }
    for (const [name, tag] of givenTags)
        tags[name] = tag;
    frozenConfig = null;
}

var pkg = {"name":"@wcstack/tilt","version":"4.28.0"};

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /io-core/platform-capability.ts by scripts/sync-io-core.mjs.
// Run `node scripts/sync-io-core.mjs` after editing the source.
// ===========================================================================
/**
 * Permissions-Policy が制御する機能。permission 名と同じ文字列と、permission の無い機能
 * (`fullscreen`・`picture-in-picture`・`web-share`: 要素が「このページで使えるか」を言うために聞く)。
 */
const POLICY_CONTROLLED = new Set([
    "camera", "microphone", "geolocation", "midi", "clipboard-read", "clipboard-write",
    "screen-wake-lock", "idle-detection", "accelerometer", "gyroscope", "magnetometer",
    "ambient-light-sensor", "display-capture", "fullscreen", "picture-in-picture", "web-share",
]);
function featureUnavailable(feature) {
    const g = globalThis;
    if (g.isSecureContext === false)
        return "insecure-context";
    if (!POLICY_CONTROLLED.has(feature))
        return null;
    const policy = g.document?.permissionsPolicy ?? g.document?.featurePolicy;
    if (policy === undefined || typeof policy.allowsFeature !== "function")
        return null;
    try {
        // このブラウザのポリシーが知らない名前は聞かない: Chromium は知らない名前の allowsFeature に
        // false を返したうえでコンソールに「Unrecognized feature」を出す(フラグの無い
        // `ambient-light-sensor`、デスクトップの `web-share`)。知らない機能は切られてもいない。
        if (typeof policy.features === "function" && !policy.features().includes(feature))
            return null;
        return policy.allowsFeature(feature) ? null : "policy-blocked";
    }
    catch {
        return null;
    }
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
 * したがって derive は「wrap された生の値」から name/message を取り出す。error として
 * _setError に届くのは 2 種類:
 * - iOS の `requestPermission()` の reject。タップ(user gesture)の外から呼ぶと iOS は
 *   質問を出さずに `NotAllowedError` で reject する。利用者の拒否ではない(利用者が
 *   拒否したときは reject ではなく `"denied"` で resolve する)。
 * - `DeviceOrientationEvent` そのものが無い環境(一部のデスクトップ、Windows 上の
 *   Playwright の WebKit)。`requestPermission()` / `start()` が `{ error: { name:
 *   "unsupported", message } }` を渡す → capability-missing。`DeviceOrientationEvent` は
 *   あるが `requestPermission` が無い環境(Android・デスクトップ)は error にせず
 *   `"granted"` に倒す(docs/device-orientation-tag-design.md §3)。
 */
/** 安定した tilt error code(taxonomy)。値は公開キーとして固定。 */
const WCS_TILT_ERROR_CODE = {
    /** `DeviceOrientationEvent` がこのブラウザに無い。 */
    CapabilityMissing: "capability-missing",
    /** `NotAllowedError` — iOS が質問を出さなかった(タップの外からの `requestPermission()`)。 */
    NotAllowed: "not-allowed",
    /** その他の `requestPermission()` reject(想定外の失敗)。 */
    TiltError: "tilt-error",
};
/**
 * tilt の失敗(`_setError` に渡る `{ error: <生の reason> }`)を serializable な error
 * taxonomy に写す。name は wrap された reason の `Error.name`、message はその `.message`
 * (無ければ `String(...)`)。
 *
 * - "unsupported" は API の欠如 → phase="probe" / capability-missing。回復しない。
 * - `NotAllowedError` は iOS が質問を出さなかった → phase="start" / not-allowed。タップから
 *   呼び直せば質問が出るので recoverable=true。
 * - それ以外(汎用 `Error`、非 Error reason 等)→ phase="execute" / tilt-error。
 */
function deriveTiltErrorInfo(detail) {
    const name = detail.error?.name;
    const message = detail.error?.message ?? String(detail.error);
    if (name === "unsupported") {
        return { code: WCS_TILT_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
    }
    if (name === "NotAllowedError") {
        return { code: WCS_TILT_ERROR_CODE.NotAllowed, phase: "start", recoverable: true, message };
    }
    return { code: WCS_TILT_ERROR_CODE.TiltError, phase: "execute", recoverable: false, message };
}

const UNSUPPORTED_SNAPSHOT = Object.freeze({
    alpha: null,
    beta: null,
    gamma: null,
    absolute: null,
});
// The browser has no `DeviceOrientationEvent` at all (some desktop browsers,
// Playwright's WebKit on Windows): nothing can be asked and no event can come.
// One shared object, so the `===` guard in _setError says it once however often
// requestPermission() / start() are called there (the shape screen-orientation
// uses for its "unsupported", docs/timing-and-firing-contract.md §7.4).
const UNSUPPORTED_ERROR = Object.freeze({
    error: Object.freeze({
        name: "unsupported",
        message: "DeviceOrientationEvent is not supported in this browser.",
    }),
});
/**
 * Headless Device Orientation primitive. A thin, framework-agnostic wrapper
 * around `window`'s `deviceorientation` event (and `deviceorientationabsolute`,
 * for `heading`) exposed through the wc-bindable protocol.
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
            { name: "alpha", event: "wcs-tilt:change", semantics: "state", getter: (e) => e.detail.alpha },
            { name: "beta", event: "wcs-tilt:change", semantics: "state", getter: (e) => e.detail.beta },
            { name: "gamma", event: "wcs-tilt:change", semantics: "state", getter: (e) => e.detail.gamma },
            { name: "absolute", event: "wcs-tilt:change", semantics: "state", getter: (e) => e.detail.absolute },
            // Degrees clockwise from north of the direction the top of the device
            // points, or null until an event says it. Its own event: north comes from
            // `deviceorientationabsolute` (Android Chrome) or `webkitCompassHeading`
            // (iOS Safari), not from the fields of wcs-tilt:change.
            { name: "heading", event: "wcs-tilt:heading-changed", semantics: "state" },
            { name: "permissionState", event: "wcs-tilt:permission-changed", semantics: "state" },
            // never-throw (§3.6): requestPermission() failures land here instead of
            // rejecting/throwing. Mirrors idle (same batch2) and the accelerometer
            // family (batch5) — see docs/io-node-batch-implementation-plan.md.
            { name: "error", event: "wcs-tilt:error", semantics: "state" },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output derived from `error.error` (the wrapped rejection's
            // Error.name); the existing `error` property/event are unchanged. Fires
            // wcs-tilt:error-info-changed. No lane — this is a monitor node.
            { name: "errorInfo", event: "wcs-tilt:error-info-changed", semantics: "state" },
            // This page can use Device Orientation: the API is there and neither a
            // Permissions-Policy nor an insecure context forbids it. Not whether the
            // device has a sensor, and not whether the user will allow it.
            { name: "supported", event: "wcs-tilt:supported-changed", semantics: "state" },
        ],
        commands: [
            { name: "requestPermission", async: true },
            { name: "start" },
            { name: "stop" },
        ],
    };
    _target;
    _snapshot = UNSUPPORTED_SNAPSHOT;
    _heading = null;
    _permissionState = "unknown";
    _error = null;
    _errorInfo = null;
    _subscribed = false;
    // The value the last wcs-tilt:supported-changed carried (none yet: false).
    _supportedPublished = false;
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
    /**
     * Degrees clockwise from north of the direction the top of the device points
     * (0 = north, 90 = east), or null until an event says it.
     */
    get heading() {
        return this._heading;
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
    /**
     * Whether this page can use Device Orientation: `DeviceOrientationEvent` is
     * there, and neither an insecure context nor a Permissions-Policy that
     * forbids `accelerometer` / `gyroscope` (Chromium sends no
     * `deviceorientation` under one) is in the way. Read at call time, never
     * cached. It cannot say whether the device has a sensor.
     */
    get supported() {
        return this._deviceOrientationEventCtor() !== undefined &&
            featureUnavailable("accelerometer") === null &&
            featureUnavailable("gyroscope") === null;
    }
    /**
     * Dispatch `wcs-tilt:supported-changed` when `supported` differs from the
     * value last dispatched (false before the first). The Shell calls it on
     * connect (through observe()), so a listener other than a binding — which
     * reads the property when it binds — learns the value too.
     */
    publishSupported() {
        const supported = this.supported;
        if (this._supportedPublished === supported)
            return;
        this._supportedPublished = supported;
        this._target.dispatchEvent(new CustomEvent("wcs-tilt:supported-changed", {
            detail: supported,
            bubbles: true,
        }));
    }
    // Lifecycle (§3.5). observe() subscribes to nothing: like `<wcs-idle>`,
    // this Core deliberately does NOT auto-start on connect (§6) on platforms
    // that gate deviceorientation behind requestPermission(). It only publishes
    // `supported`.
    observe() {
        this.publishSupported();
        return this._ready;
    }
    dispose() {
        this.stop();
    }
    _deviceOrientationEventCtor() {
        const g = globalThis;
        return typeof g.DeviceOrientationEvent === "function" ? g.DeviceOrientationEvent : undefined;
    }
    // Same-value guard (§3.3 MUST).
    _setHeading(heading) {
        if (this._heading === heading)
            return;
        this._heading = heading;
        this._target.dispatchEvent(new CustomEvent("wcs-tilt:heading-changed", {
            detail: heading,
            bubbles: true,
        }));
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
     * `permissionState` changes only when the browser answers. A rejection is
     * not an answer: iOS rejects (`NotAllowedError`) when the call does not come
     * from a tap, without showing the question, and a later call from a tap can
     * still be granted. So a rejection leaves `permissionState` as it was, puts
     * the raw error in `error` (never-throw, §3.6) and resolves to the unchanged
     * state. Where the browser has no `DeviceOrientationEvent` at all it is the
     * same: `error` says so (`capability-missing`) and the state stays.
     *
     * Any answer — granted, a plain denied, the immediate granted of a platform
     * without the gate — supersedes a stale `error` from an earlier attempt, as
     * in `<wcs-idle>`'s `requestPermission()` (docs/idle-detection-tag-design.md
     * §4.1).
     */
    async requestPermission() {
        const Ctor = this._deviceOrientationEventCtor();
        if (Ctor === undefined) {
            this._setError(UNSUPPORTED_ERROR);
            return this._permissionState;
        }
        if (typeof Ctor.requestPermission !== "function") {
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
            // never-throw. The browser refused to ask: the user was not asked, so
            // nothing is known about the permission that was not known before.
            this._setError({ error: e });
            return this._permissionState;
        }
    }
    /**
     * Subscribe to `deviceorientation`, and to `deviceorientationabsolute` where
     * the browser has it (the event Android Chrome carries north in). Idempotent
     * — a second start() while already subscribed is a no-op. Where the browser
     * has no `DeviceOrientationEvent`, no event can come: `error` says so and
     * nothing is subscribed.
     */
    start() {
        if (this._subscribed)
            return;
        if (this._deviceOrientationEventCtor() === undefined) {
            this._setError(UNSUPPORTED_ERROR);
            return;
        }
        this._subscribed = true;
        const win = globalThis.window;
        win?.addEventListener("deviceorientation", this._onOrientation);
        if (win && "ondeviceorientationabsolute" in win) {
            win.addEventListener("deviceorientationabsolute", this._onAbsoluteOrientation);
        }
    }
    /** Unsubscribe from both events. Safe to call when not started. */
    stop() {
        if (!this._subscribed)
            return;
        this._subscribed = false;
        const win = globalThis.window;
        win?.removeEventListener("deviceorientation", this._onOrientation);
        win?.removeEventListener("deviceorientationabsolute", this._onAbsoluteOrientation);
    }
    _onOrientation = (event) => {
        this._apply({
            alpha: event.alpha,
            beta: event.beta,
            gamma: event.gamma,
            absolute: event.absolute,
        });
        // North. iOS Safari: `alpha` is relative and the compass is the
        // non-standard `webkitCompassHeading`, already clockwise from north.
        // Elsewhere only an event that says it is absolute carries north.
        const compass = event.webkitCompassHeading;
        if (typeof compass === "number" && Number.isFinite(compass)) {
            this._setHeading(compass);
        }
        else if (event.absolute === true) {
            this._applyAbsoluteAlpha(event.alpha);
        }
    };
    // `deviceorientationabsolute` (Android Chrome, where `deviceorientation` is
    // relative): north only. alpha / beta / gamma / absolute keep coming from
    // `deviceorientation`, so this event writes none of them.
    _onAbsoluteOrientation = (event) => {
        this._applyAbsoluteAlpha(event.alpha);
    };
    // An absolute `alpha` grows counter-clockwise from north; a compass heading
    // grows clockwise. An event without a finite `alpha` says nothing about north.
    _applyAbsoluteAlpha(alpha) {
        if (typeof alpha === "number" && Number.isFinite(alpha)) {
            this._setHeading((360 - alpha) % 360);
        }
    }
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

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/upgrade-properties.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
function hasAccessorOnPrototype(target, name) {
    let proto = Object.getPrototypeOf(target);
    while (proto !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (descriptor !== undefined) {
            return typeof descriptor.get === "function" || typeof descriptor.set === "function";
        }
        proto = Object.getPrototypeOf(proto);
    }
    return false;
}
// 属性になってしまったオブジェクトの入力（`files="[object File]"`）を、要素ごとに 1 回だけ言う。
// React 19 は定義前の要素にプロパティが無いのでオブジェクトを属性に書き、Vue の `.attr` も
// 書く。要素はその入力をプロパティでしか読まないので、何も受け取らず、何も言わなかった
// （docs/seam-apps.md、fw-inventory）。
const toldObjectAttribute = new WeakSet();
function warnObjectAttribute(element, name, value) {
    if (toldObjectAttribute.has(element))
        return;
    toldObjectAttribute.add(element);
    const tag = element.localName ?? "element";
    console.warn(`[wcs/input-as-attribute] <${tag}> has the attribute ${name}="${value}": an object was written as an ` +
        `attribute, so the element did not receive it. A framework does that when the property is set before the ` +
        `element's definition loads (React 19), or when told to (Vue's .attr). Load the definition before rendering, ` +
        `or assign the property through a ref (Vue: .prop). (Said once per element.)`, element);
}
/**
 * `connectedCallback` の先頭で呼ぶ。宣言済み input のうち upgrade 前の代入で
 * accessor をシャドウしている own プロパティを、delete → 再代入で setter に通し直す。
 *
 * - 冪等: 再代入は accessor を通るので own プロパティは残らず、2 回目以降は no-op。
 * - 宣言に `inputs` が無い要素、`wcBindable` を持たない要素では何もしない。
 * - 値の意味は変えない。今まで捨てられていた代入が届くようになる一方向の変化。
 * - 値が `[object …]` の属性（属性に書かれてしまったオブジェクトの入力）は、要素ごとに 1 回警告する。
 */
function upgradeProperties(element) {
    const declaration = element.constructor?.wcBindable;
    const inputs = declaration?.inputs;
    if (inputs === undefined)
        return;
    const getAttribute = element.getAttribute;
    for (const input of inputs) {
        const name = input.name;
        const attribute = typeof getAttribute === "function" ? getAttribute.call(element, name.toLowerCase()) : null;
        if (attribute !== null && attribute.startsWith("[object "))
            warnObjectAttribute(element, name, attribute);
        if (!Object.prototype.hasOwnProperty.call(element, name))
            continue;
        if (!hasAccessorOnPrototype(element, name))
            continue;
        const record = element;
        const value = record[name];
        delete record[name];
        record[name] = value;
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
    get heading() {
        return this._core.heading;
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
    // Computed at call time: a binding reads it when it binds, with no event.
    get supported() {
        return this._core.supported;
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
        // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
        upgradeProperties(this);
        this.style.display = "none";
        // Subscribes to nothing; publishes `supported` when it differs from the value last dispatched.
        this._connectedCallbackPromise = this._core.observe();
    }
    // Moved by moveBefore() (a list row a reorder moves): where this element is changes nothing of what it
    // does, so nothing stops and nothing starts again. With no connectedMoveCallback the browser calls
    // disconnectedCallback and connectedCallback instead (docs/timing-and-firing-contract.md §25)
    connectedMoveCallback() { }
    disconnectedCallback() {
        this._core.dispose();
    }
}

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/define-element.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
/**
 * One copy of each package on a page (docs/timing-and-firing-contract.md §24). The first copy the
 * page evaluates defines the tags and a second one does nothing, so a copy that finds its tag defined
 * by another copy of the package — not its class, not a subclass of it, not the same version — warns
 * `[wcs/package-twice]` once per registry, naming both versions. The classes it defines carry
 * `"<package>@<version>"` under `Symbol.for("wcstack.package")`; a class without it is named
 * "another copy of <package> that does not name its version" (an older copy, or one loaded through
 * an entry that does not stamp).
 */
/** The static a class defined through this helper carries: `"@wcstack/fetch@<version>"`. */
const PACKAGE_STAMP = Symbol.for("wcstack.package");
/** The registries this copy warned about: one warning per package per registry. */
const warned = new WeakSet();
/**
 * Marks `cls` as defined by `pkg` (`"@wcstack/fetch@<version>"`). A subclass inherits the mark, and
 * `defineProperty` writes it even where a parent's mark is read-only.
 */
function stampPackage(cls, pkg) {
    Object.defineProperty(cls, PACKAGE_STAMP, { value: pkg, configurable: true });
}
/**
 * Warns when `tag` is defined as `existing` by another copy of the package `pkg` names: `existing`
 * is neither `own` nor a subclass of it (omit `own` when the copy has no class to compare with), and
 * carries another version or none. Once per registry.
 */
function warnIfAnotherCopy(registry, tag, existing, own, pkg) {
    if (own !== undefined && (existing === own || existing.prototype instanceof own))
        return;
    const theirs = existing[PACKAGE_STAMP];
    if (theirs === pkg || warned.has(registry))
        return;
    warned.add(registry);
    const name = pkg.slice(0, pkg.lastIndexOf("@"));
    console.warn(`[${name}] [wcs/package-twice] <${tag}> is already defined by ` +
        `${theirs ?? `another copy of ${name} that does not name its version`}; ` +
        `this copy, ${pkg}, does nothing. Load each package once.`);
}
/**
 * Defines each `[tag, class]` in `registry` unless the tag is already defined, stamping the class
 * with `pkg` (`"@wcstack/fetch@<version>"`). A tag another copy of the package defined first is left
 * as it is, with the warning above.
 */
function defineElements(registry, pkg, definitions) {
    for (const [tag, cls] of definitions) {
        const existing = registry.get(tag);
        if (existing === undefined) {
            stampPackage(cls, pkg);
            registry.define(tag, cls);
        }
        else {
            warnIfAnotherCopy(registry, tag, existing, cls, pkg);
        }
    }
}

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
function registerComponents(registry = customElements) {
    defineElements(registry, `${pkg.name}@${pkg.version}`, [
        [config.tagNames.tilt, WcsTilt],
    ]);
}

function bootstrapTilt(userConfig, registry) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents(registry);
}

export { TiltCore, WCS_TILT_ERROR_CODE, WcsTilt, bootstrapTilt, getConfig };
//# sourceMappingURL=index.esm.js.map

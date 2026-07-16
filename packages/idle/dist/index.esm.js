const _config = {
    tagNames: {
        idle: "wcs-idle",
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
 * idleCapabilities.ts
 *
 * Idle Detection node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。idle は requestPermission()/start()/stop() の単一コマンド経路で、競合する
 * operation を持たない(2 回目の start() は前を stop() してから開始する supersede)ため
 * lane は持たず、error taxonomy(errorInfo)のみを採用する。
 *
 * この node の `_setError` は 2 形態の入力を受ける:
 *   1. synthetic な非対応マーカー(`{ message: "IdleDetector is not supported…" }`、
 *      `.name` 無し)— `globalThis.IdleDetector` 不在。
 *   2. caught された rejection を包んだ `{ error: e }`(`e.name` が実 Error.name)。
 * 両者を message coupling 無しに弁別するため、呼び出し側が明示的な `name` ヒントを渡す
 * (storage の `deriveStorageErrorInfo(error, name)` / screen-orientation と同じ
 * discriminator 技法)。非対応経路は `"unsupported"` を、caught 経路は wrap した
 * `e?.name` を渡す。
 *
 * requestPermission()/start() の実 rejection 名は spec のとおり gesture 文脈外 /
 * 権限未許可で `NotAllowedError`。それ以外(生の Error / TypeError(threshold 不正)/
 * `.name` 欠如の nullish reject 等)は一括して `idle-error`。
 */
/** 安定した idle error code(taxonomy)。値は公開キーとして固定。 */
const WCS_IDLE_ERROR_CODE = {
    /** Idle Detection API 非対応(`globalThis.IdleDetector` 不在)。 */
    CapabilityMissing: "capability-missing",
    /** `NotAllowedError` — 権限拒否 / user-gesture 文脈外。retry では回復しない。 */
    NotAllowed: "not-allowed",
    /** その他の requestPermission()/start() 失敗(生 throw / TypeError / nullish reject 等)。 */
    IdleError: "idle-error",
};
/**
 * idle の失敗を serializable な error taxonomy に写す。
 *
 * `name` は呼び出し側が渡す discriminator:synthetic 非対応なら `"unsupported"`、
 * caught 例外なら wrap した `e?.name`(生の非 Error / nullish reject では `undefined`)。
 * `message` は wrap を解いた下位値から抽出済みの文言(非対応なら synthetic の message)。
 *
 * - `"unsupported"` は利用直前の能力欠如 → phase="probe" / capability-missing。
 * - `NotAllowedError` は requestPermission()/start() の権限ゲート失敗 → phase="start" /
 *   not-allowed / recoverable=false(gesture 違反と実 "denied" は区別しない設計 §4.1)。
 * - それ以外(生の throw、TypeError、`.name` 欠如等)は実行中の失敗 → phase="execute" /
 *   idle-error / recoverable=false。
 */
function deriveIdleErrorInfo(name, message) {
    if (name === "unsupported") {
        return { code: WCS_IDLE_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
    }
    if (name === "NotAllowedError") {
        return { code: WCS_IDLE_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message };
    }
    return { code: WCS_IDLE_ERROR_CODE.IdleError, phase: "execute", recoverable: false, message };
}

const MIN_THRESHOLD = 60000;
/**
 * Headless Idle Detection primitive. A thin, framework-agnostic wrapper around
 * `IdleDetector` exposed through the wc-bindable protocol.
 *
 * Reference implementation for batch2's "gesture-gated permission" archetype
 * (docs/idle-detection-tag-design.md). `requestPermission()` wraps the static,
 * user-gesture-gated `IdleDetector.requestPermission()` — this Core never
 * calls it automatically; the caller must invoke it from within a real
 * gesture handler.
 *
 * Deliberately does NOT track the 4-value permission state (prompt/granted/
 * denied/unsupported) itself: `navigator.permissions.query({name:
 * "idle-detection"})` exists, so compose with `<wcs-permission
 * name="idle-detection">` for that instead (§0). This Core only exposes the
 * actual idle state (userState/screenState) plus the one-time
 * requestPermission()/start()/stop() actions.
 */
class IdleCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "userState", event: "wcs-idle:change", getter: (e) => e.detail.userState },
            { name: "screenState", event: "wcs-idle:change", getter: (e) => e.detail.screenState },
            {
                name: "active",
                event: "wcs-idle:change",
                getter: (e) => e.detail.userState === "active",
            },
            // never-throw (§3.6): requestPermission()/start() failures land here
            // instead of rejecting/throwing. Mirrors every other bidirectional IO
            // node in this batch (fetch, share, screen-orientation).
            { name: "error", event: "wcs-idle:error" },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output derived from `error` (capability-missing / not-allowed
            // / idle-error); the existing `error` property/event are unchanged. Fires
            // wcs-idle:error-info-changed. No lane — requestPermission()/start()/stop() form a
            // single command path (a 2nd start() supersedes the 1st), not competing operations.
            { name: "errorInfo", event: "wcs-idle:error-info-changed" },
        ],
        // No `inputs`: the Core has no settable `threshold` state — `threshold` is a
        // per-call argument to `start(threshold)`, not a property/setter. The DOM-driven
        // `threshold` input surface belongs to the Shell (which declares it and backs it
        // with the `threshold` attribute), mirroring geolocation/intersection where the
        // Core declares no inputs and the Shell adds them.
        commands: [
            { name: "requestPermission", async: true },
            { name: "start", async: true },
            { name: "stop" },
        ],
    };
    _target;
    _userState = null;
    _screenState = null;
    _error = null;
    // Additive failure taxonomy, kept strictly in sync with `_error` (derived on
    // every _setError, cleared to null when error clears). The two transition together.
    _errorInfo = null;
    _detector = null;
    _abortController = null;
    // Generation guard (§3.4): bumped on dispose()/stop() and each start().
    _gen = 0;
    // SSR (§3.8): never auto-starts on connect, so there is no probe to await —
    // readiness is always immediate (docs/idle-detection-tag-design.md §7).
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get ready() {
        return this._ready;
    }
    get userState() {
        return this._userState;
    }
    get screenState() {
        return this._screenState;
    }
    get active() {
        return this._userState === "active";
    }
    get error() {
        return this._error;
    }
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-idle:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
    }
    // Lifecycle (§3.5). observe() is a synchronous no-op: unlike most IO nodes,
    // this Core deliberately does NOT auto-start on connect (§6) — permission
    // is gesture-gated, so attempting start() before it is granted is
    // guaranteed to fail.
    observe() {
        return this._ready;
    }
    dispose() {
        this.stop();
    }
    _api() {
        const g = globalThis;
        return typeof g.IdleDetector === "function" ? g.IdleDetector : undefined;
    }
    _setState(userState, screenState) {
        if (this._userState === userState && this._screenState === screenState)
            return;
        this._userState = userState;
        this._screenState = screenState;
        this._target.dispatchEvent(new CustomEvent("wcs-idle:change", {
            detail: { userState, screenState },
            bubbles: true,
        }));
    }
    // `name` is the discriminator for the additive `errorInfo` taxonomy only (it
    // stays out of the public `error` shape): the synthetic unsupported marker has
    // no `.name`, so the unsupported call sites pass an explicit `"unsupported"`
    // hint (storage/screen-orientation-style — avoids coupling to `error.message`),
    // while the caught paths pass the wrapped rejection's `Error.name` (`e?.name`).
    // `null` clears (no name).
    _setError(error, name) {
        if (this._error === error)
            return;
        this._error = error;
        // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the
        // discriminator + extracted message (or null on clear). Fires before the `error`
        // event so an observer binding both sees the classification first, mirroring the
        // io-node family.
        this._commitErrorInfo(error === null ? null : deriveIdleErrorInfo(name, this._errorInfoMessage(error)));
        this._target.dispatchEvent(new CustomEvent("wcs-idle:error", {
            detail: error,
            bubbles: true,
        }));
    }
    // Extract a serializable string message for `errorInfo` WITHOUT normalizing the
    // public `error` shape. The public error is either the synthetic `{ message }`
    // (unsupported) or a wrapped `{ error: e }` (a caught rejection). For the wrapped
    // form the meaningful message lives on `e`, so unwrap one level before reading
    // `.message`; a non-conformant / nullish value (e.g. `Promise.reject(undefined)`)
    // falls back to `String(...)` so it still classifies instead of throwing
    // (never-throw §3.6).
    _errorInfoMessage(error) {
        const src = error != null && typeof error === "object" && "error" in error ? error.error : error;
        return typeof src?.message === "string" ? src.message : String(src);
    }
    // Called only from _setError (which already same-value-guards on the error
    // reference), so errorInfo transitions exactly when error does — no separate
    // guard needed here.
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-idle:error-info-changed", {
            detail: info,
            bubbles: true,
        }));
    }
    /**
     * Wraps the static, user-gesture-gated `IdleDetector.requestPermission()`.
     * MUST be invoked from within a real user gesture handler by the caller —
     * this Core cannot manufacture one. never-throw: a gesture-context
     * rejection resolves to `"denied"` and lands in `error`. Gesture violation
     * and an actual "denied" outcome are not distinguished — both mean "not
     * usable right now" (§4.1).
     */
    async requestPermission() {
        const Ctor = this._api();
        if (!Ctor) {
            this._setError({ message: "IdleDetector is not supported in this browser" }, "unsupported");
            return "denied";
        }
        try {
            const result = await Ctor.requestPermission();
            // Symmetric with start()'s success path: any settled (non-throwing)
            // outcome — granted or a plain "denied" — supersedes a stale error from
            // an earlier attempt (e.g. a prior gesture-context rejection).
            this._setError(null);
            return result === "granted" ? "granted" : "denied";
        }
        catch (e) {
            this._setError({ error: e }, e?.name);
            return "denied";
        }
    }
    /**
     * Start an idle-detection session. `threshold` (ms) must be >= 60000 per
     * spec — not validated here (§3): an out-of-range value is left to the
     * browser's own TypeError, which never-throw absorbs into `error`.
     */
    async start(threshold = MIN_THRESHOLD) {
        this.stop(); // supersede any in-flight session (mirrors FetchCore's "cancel then start")
        const Ctor = this._api();
        if (!Ctor) {
            this._setError({ message: "IdleDetector is not supported in this browser" }, "unsupported");
            return;
        }
        const ac = new AbortController();
        this._abortController = ac;
        const gen = ++this._gen;
        try {
            const detector = new Ctor();
            detector.addEventListener("change", this._onChange);
            this._detector = detector;
            await detector.start({ threshold, signal: ac.signal });
            if (gen !== this._gen)
                return; // stale (stop()/dispose() ran during the await)
            this._setError(null);
            this._setState(detector.userState, detector.screenState);
        }
        catch (e) {
            // No separate AbortError check: stop()/dispose() bump `_gen` *before*
            // calling `ac.abort()` (see stop() below), so a stop()-triggered
            // AbortError always has a stale `gen` here and is already caught by
            // the check above. The signal is private and never exposed, so an
            // AbortError from any other source cannot occur.
            if (gen !== this._gen)
                return;
            // Tear down the failed session's listener/controller (mirrors stop()):
            // without this, the failed `_detector` stays wired to `_onChange` and a
            // later `change` on that same (never-truly-started) instance would
            // still write state, contradicting the error just recorded.
            this._detector?.removeEventListener("change", this._onChange);
            this._detector = null;
            this._abortController = null;
            this._setError({ error: e }, e?.name);
        }
    }
    /** Stop the current session (if any) and detach its listener. Safe to call when not started. */
    stop() {
        this._gen++;
        this._abortController?.abort();
        this._abortController = null;
        if (this._detector) {
            this._detector.removeEventListener("change", this._onChange);
            this._detector = null;
        }
    }
    _onChange = (event) => {
        const detector = event.target;
        this._setState(detector.userState, detector.screenState);
    };
}

/**
 * `<wcs-idle>` — declarative Idle Detection API primitive.
 *
 * Does NOT auto-start on connect (docs/idle-detection-tag-design.md §6): the
 * permission gate sits in front of `start()`, so an unconditional
 * connectedCallback start would be guaranteed to fail before permission is
 * granted. Callers drive `requestPermission()` → `start()` explicitly, e.g.
 * from a click handler.
 *
 * Compose with `<wcs-permission name="idle-detection">` for prompt/granted/
 * denied status — this Shell only exposes the actual idle state.
 */
class WcsIdle extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...IdleCore.wcBindable,
        inputs: [
            { name: "threshold", attribute: "threshold" },
        ],
        // Core の commands をそのまま継承（単一情報源）。
        commands: IdleCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new IdleCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-idle:change": (d) => ({ active: d.userState === "active" }),
            "wcs-idle:error": (d) => ({ error: d != null }),
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
        // never-throw (docs/custom-state-reflection-design.md §3.1/§3.4): attachInternals
        // is absent in happy-dom / older environments, and pre-125 Chromium rejects
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
     * Minimum idle time (ms) before `userState` becomes `"idle"`. This value is
     * read only at `start()` time — there is no `attributeChangedCallback`
     * (deliberately not declared in `observedAttributes`, mirroring
     * `<wcs-gyroscope>`'s `frequency`), so mutating the attribute/property on an
     * already-running session has no effect until the caller `stop()`s and
     * `start()`s again.
     */
    get threshold() {
        const attr = this.getAttribute("threshold");
        // An absent, empty, or whitespace-only attribute all mean "no value
        // supplied" and must fall back to the default — without this check,
        // `Number("")`/`Number("  ")` coerce to `0` (finite), which would slip
        // past the `Number.isFinite` fallback below and silently return `0`
        // instead of the documented 60000ms default.
        if (attr === null || attr.trim() === "")
            return 60000;
        const n = Number(attr);
        return Number.isFinite(n) ? n : 60000;
    }
    set threshold(value) {
        this.setAttribute("threshold", String(value));
    }
    // --- Core delegated getters ---
    get userState() {
        return this._core.userState;
    }
    get screenState() {
        return this._core.screenState;
    }
    get active() {
        return this._core.active;
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
    start(threshold) {
        return this._core.start(threshold ?? this.threshold);
    }
    stop() {
        this._core.stop();
    }
    // --- Lifecycle ---
    connectedCallback() {
        this.style.display = "none";
        // No auto-start (§6) — observe() is a synchronous no-op, kept only for
        // API uniformity with other IO nodes' lifecycle.
        this._connectedCallbackPromise = this._core.observe();
    }
    disconnectedCallback() {
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.idle)) {
        customElements.define(config.tagNames.idle, WcsIdle);
    }
}

function bootstrapIdle(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { IdleCore, WCS_IDLE_ERROR_CODE, WcsIdle, bootstrapIdle, getConfig };
//# sourceMappingURL=index.esm.js.map

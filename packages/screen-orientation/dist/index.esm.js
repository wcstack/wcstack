const _config = {
    tagNames: {
        screenOrientation: "wcs-screen-orientation",
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
 * screenOrientationCapabilities.ts
 *
 * Screen Orientation node 固有の error code(taxonomy)と derivation。汎用の error info
 * 型は `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。screen.orientation の監視(change 購読)は同期で競合する operation を持た
 * ないため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 *
 * この node は bidirectional で、失敗は `lock()`/`unlock()` から来る。`_setError` は
 * 2 形態の入力を受ける:
 *   1. synthetic な `UNSUPPORTED_ERROR`(`{ message: "unsupported" }`、`.name` 無し)
 *      — API / メソッド自体が不在。
 *   2. caught された生の rejection / 例外(`.name` を持つ)。
 * 両者を message coupling 無しに弁別するため、呼び出し側が明示的な `name` ヒントを渡す
 * (storage の `deriveStorageErrorInfo(error, name)` と同じ discriminator 技法)。
 * unsupported 経路は `"unsupported"` を、caught 経路は `Error.name` を渡す。
 *
 * lock() の実 rejection 名は README.md §"lock() needs a fullscreen…" と Core JSDoc §5 の
 * とおり `NotAllowedError` / `NotSupportedError` / `SecurityError`(いずれも plain-tab で
 * lock が効かない同一の実務的結末=「name で分岐するな」)+ spec の `AbortError`(新しい
 * lock() に取って代わられた)。前者 3 名は同一 `not-allowed` に畳む(README のモデルに一致)。
 */
/** 安定した screen-orientation error code(taxonomy)。値は公開キーとして固定。 */
const WCS_SCREEN_ORIENTATION_ERROR_CODE = {
    /** `screen.orientation` / `lock()`・`unlock()` 自体が不在(synthetic "unsupported")。 */
    CapabilityMissing: "capability-missing",
    /**
     * `NotAllowedError` / `NotSupportedError` / `SecurityError` — 非 fullscreen /
     * plain-tab / feature-policy / sandbox で lock が効かない。README のモデルどおり
     * 三者は同一の実務的結末なので 1 code に畳む。retry では回復しない。
     */
    NotAllowed: "not-allowed",
    /** `AbortError` — より新しい `lock()` に取って代わられた。fresh lock は成功しうる。 */
    Aborted: "aborted",
    /** その他の `lock()`/`unlock()` 失敗。 */
    OrientationError: "orientation-error",
};
/**
 * screen-orientation の失敗を serializable な error taxonomy に写す。
 *
 * `name` は呼び出し側が渡す discriminator:synthetic unsupported なら `"unsupported"`、
 * caught 例外なら `Error.name`(生の非 Error throw では `undefined`)。`message` は
 * 公開 `error` と同じ文言(unsupported なら "unsupported")。
 *
 * - `"unsupported"` は利用直前の能力欠如 → phase="probe" / capability-missing。
 * - `NotAllowedError` / `NotSupportedError` / `SecurityError` は lock() 実行時に
 *   context が満たされず lock が効かない → phase="execute" / not-allowed / recoverable=false。
 * - `AbortError` は新しい lock() による supersede → phase="execute" / aborted /
 *   recoverable=true(fresh な lock() は成功しうる)。
 * - それ以外(spec の `InvalidStateError`、生の throw、`.name` 欠如等)は
 *   phase="execute" / orientation-error。
 */
function deriveScreenOrientationErrorInfo(name, message) {
    if (name === "unsupported") {
        return { code: WCS_SCREEN_ORIENTATION_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
    }
    if (name === "NotAllowedError" || name === "NotSupportedError" || name === "SecurityError") {
        return { code: WCS_SCREEN_ORIENTATION_ERROR_CODE.NotAllowed, phase: "execute", recoverable: false, message };
    }
    if (name === "AbortError") {
        return { code: WCS_SCREEN_ORIENTATION_ERROR_CODE.Aborted, phase: "execute", recoverable: true, message };
    }
    return { code: WCS_SCREEN_ORIENTATION_ERROR_CODE.OrientationError, phase: "execute", recoverable: false, message };
}

const UNSUPPORTED_SNAPSHOT = Object.freeze({
    type: null,
    angle: null,
});
// Shared reference so the same-value guard in `_setError` (§3.3 MUST) actually
// suppresses a redundant redispatch across repeated unsupported lock()/unlock()
// calls. A freshly-allocated `{ message: "unsupported" }` literal at each call
// site would compare unequal to itself by reference and defeat the guard.
const UNSUPPORTED_ERROR = Object.freeze({ message: "unsupported" });
/**
 * Headless Screen Orientation primitive. A thin, framework-agnostic wrapper
 * around `screen.orientation` exposed through the wc-bindable protocol.
 *
 * Like `@wcstack/network`, monitoring needs no `_gen` generation guard (§6.1):
 * subscribing/unsubscribing to `screen.orientation`'s `change` event is fully
 * synchronous, so there is no asynchronous probe whose stale resolution could
 * race a dispose() (docs/screen-orientation-tag-design.md §6.1).
 *
 * Unlike `network`, this Core is **bidirectional**: it also exposes `lock()`/
 * `unlock()` commands. `lock()` is asynchronous and in-flight, so it needs its
 * own single `_gen` generation guard — independent from (and unrelated to) the
 * synchronous monitoring path (docs/screen-orientation-tag-design.md §6.2).
 * This asymmetry (monitor: no `_gen`; command: `_gen` required) is the
 * defining trait of this node within the IO-node batch.
 */
class ScreenOrientationCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "type", event: "wcs-orientation:change", getter: (e) => e.detail.type },
            { name: "angle", event: "wcs-orientation:change", getter: (e) => e.detail.angle },
            {
                name: "portrait",
                event: "wcs-orientation:change",
                getter: (e) => e.detail.type?.startsWith("portrait") ?? false,
            },
            {
                name: "landscape",
                event: "wcs-orientation:change",
                getter: (e) => e.detail.type?.startsWith("landscape") ?? false,
            },
            // never-throw (§3.6, async-io-node-guidelines): lock()/unlock() failures
            // land here instead of rejecting/throwing. Mirrors the `error` property
            // every other bidirectional IO node exposes (FetchCore, GeolocationCore,
            // NotificationCore) so `hidden@error`-style bindings work uniformly.
            { name: "error", event: "wcs-orientation:error" },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output derived from `error` (capability-missing / not-allowed
            // / aborted / orientation-error); the existing `error` property/event are
            // unchanged. Fires wcs-orientation:error-info-changed. No lane — monitoring is a
            // synchronous subscribe and lock()/unlock() are a single command path, not
            // competing operations.
            { name: "errorInfo", event: "wcs-orientation:error-info-changed" },
        ],
        commands: [
            { name: "lock", async: true },
            { name: "unlock" },
        ],
    };
    _target;
    _snapshot = UNSUPPORTED_SNAPSHOT;
    // Sticky by design: unlike `_snapshot` (re-read from the live platform
    // object on every observe()), `_error` is never reset by dispose() or a
    // later observe() — it holds the most recent lock()/unlock() failure across
    // a disconnect/reconnect cycle and is only replaced by the next lock()/
    // unlock() call (success clears it via `_setError(null)`; a new failure
    // overwrites it). There is no "current value" to re-read for a command
    // outcome the way there is for the platform's live type/angle, so nothing
    // to resync on reconnect. This asymmetry with `_snapshot` is intentional
    // and matches the dominant IO-node pattern: GeolocationCore, WakeLockCore,
    // FullscreenCore, ClipboardCore, and NotificationCore all leave their error
    // field untouched in dispose() too.
    _error = null;
    // Additive failure taxonomy, kept strictly in sync with `_error` (derived on
    // every _setError, cleared to null when error clears). Sticky across
    // dispose()/observe() exactly like `_error` — the two transition together.
    _errorInfo = null;
    // The live ScreenOrientation object the `change` listener is attached to
    // (kept so dispose() can remove it precisely; not read for anything else).
    _orientation = null;
    // True once observe() has attached the live listener (or determined there is
    // nothing to attach to). Guards observe() so a redundant call does not
    // re-subscribe; dispose() resets it so a later observe() resumes cleanly.
    _subscribed = false;
    // Generation guard for the `lock()`/`unlock()` COMMAND path only (§6.2). This
    // is entirely independent of monitoring (§6.1, which needs no `_gen` at all
    // because subscribing to `change` is fully synchronous). `lock()` is
    // asynchronous and in-flight: an old `lock()` call resolving after a newer
    // `lock()`/`unlock()` call (or a dispose()) must not clobber the state that
    // call already established. Bumped by every lock() start, by unlock(), and
    // by dispose().
    _gen = 0;
    // SSR (§3.8): no asynchronous probe to await for monitoring — observe()
    // completes synchronously, so readiness is immediate.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get ready() {
        return this._ready;
    }
    get type() {
        return this._snapshot.type;
    }
    get angle() {
        return this._snapshot.angle;
    }
    get portrait() {
        return this._snapshot.type?.startsWith("portrait") ?? false;
    }
    get landscape() {
        return this._snapshot.type?.startsWith("landscape") ?? false;
    }
    get error() {
        return this._error;
    }
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-orientation:error-info-changed`), derived from `error`; the existing
     * `error` property/event are unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
    }
    // Lifecycle (§3.5). Idempotent: a second observe() while already subscribed
    // is a no-op (no double listener, no redundant dispatch). Synchronous overall
    // (no probe to await), so the returned promise is only for API uniformity
    // with other IO nodes.
    observe() {
        if (!this._subscribed) {
            this._subscribed = true;
            const api = this._api();
            if (api) {
                this._orientation = api;
                api.addEventListener("change", this._onChange);
            }
            this._apply(this._read());
        }
        return this._ready;
    }
    dispose() {
        this._subscribed = false;
        if (this._orientation) {
            this._orientation.removeEventListener("change", this._onChange);
            this._orientation = null;
        }
        // Invalidate any in-flight lock() so its resolution bails instead of
        // writing to a torn-down instance (§6.2).
        this._gen++;
    }
    /**
     * Request a specific orientation lock. Best-effort (§5): most desktop
     * browsers reject with `NotSupportedError` outside a mobile / fullscreen
     * context. never-throw (§3.6) — failures land in `error`, never as a
     * rejected promise from the caller's perspective (the returned promise
     * always resolves). Validation is intentionally NOT performed (§4): the
     * value is passed through verbatim and an unrecognized string is left to
     * the browser to reject.
     */
    async lock(orientation) {
        const gen = ++this._gen;
        const api = this._api();
        if (!api || typeof api.lock !== "function") {
            // No stale-generation check here: nothing asynchronous has happened yet
            // since `gen` was captured immediately above, so `_gen` cannot have
            // changed underneath this synchronous branch.
            this._setError(UNSUPPORTED_ERROR, "unsupported");
            return;
        }
        try {
            await api.lock(orientation);
            if (gen !== this._gen)
                return;
            this._setError(null);
        }
        catch (e) {
            if (gen !== this._gen)
                return;
            this._setError(e, e?.name);
        }
    }
    /**
     * Release a previously requested orientation lock. Synchronous (mirrors the
     * platform API) — no promise to await, no rejection to absorb. Bumps `_gen`
     * so an in-flight `lock()` cannot resolve after this call and overwrite the
     * state unlock() just established (§6.2).
     */
    unlock() {
        this._gen++;
        const api = this._api();
        if (!api || typeof api.unlock !== "function") {
            this._setError(UNSUPPORTED_ERROR, "unsupported");
            return;
        }
        try {
            api.unlock();
            this._setError(null);
        }
        catch (e) {
            this._setError(e, e?.name);
        }
    }
    // API resolution is call-time, never cached (§3.7, §7): lets tests
    // install/remove screen.orientation freely and lets an unsupported
    // environment be detected correctly on every observe()/command call.
    _api() {
        return typeof screen !== "undefined" && screen.orientation ? screen.orientation : undefined;
    }
    _read() {
        const o = this._api();
        if (!o) {
            return UNSUPPORTED_SNAPSHOT;
        }
        return {
            type: typeof o.type === "string" ? o.type : null,
            angle: typeof o.angle === "number" ? o.angle : null,
        };
    }
    _onChange = () => {
        this._apply(this._read());
    };
    // Same-value guard (§3.3 MUST) on `error` itself, mirroring FetchCore's
    // `_setError`-adjacent state fields: a repeated `null` (e.g. a second
    // successful lock()) must not redispatch. `unsupported` (§7) is reported the
    // same way as any other lock()/unlock() failure — there is no dedicated
    // unsupported state, only `error`. This guard is a `===` reference check, so
    // repeated unsupported calls only stay deduped because both call sites pass
    // the shared `UNSUPPORTED_ERROR` constant rather than a fresh object literal.
    //
    // `name` is the discriminator for the additive `errorInfo` taxonomy only (it
    // stays out of the public `error` shape): the synthetic UNSUPPORTED_ERROR has
    // no `.name`, so the unsupported call sites pass an explicit `"unsupported"`
    // hint (storage-style — avoids coupling to `error.message`), while the caught
    // paths pass `Error.name`. `null` clears (no name).
    _setError(error, name) {
        if (this._error === error)
            return;
        this._error = error;
        // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the
        // discriminator (or null on clear). Fires before the `error` event so an
        // observer binding both sees the classification first, mirroring the io-node
        // family.
        this._commitErrorInfo(error === null ? null : deriveScreenOrientationErrorInfo(name, this._errorInfoMessage(error)));
        this._target.dispatchEvent(new CustomEvent("wcs-orientation:error", {
            detail: error,
            bubbles: true,
        }));
    }
    // Extract a serializable string message for `errorInfo` WITHOUT normalizing the
    // public `error` shape (which keeps the raw rejection value verbatim). A caught
    // value with a non-string `.message` — or a non-conformant nullish/non-object
    // rejection such as `Promise.reject(undefined)` — falls back to `String(error)`
    // so it still classifies instead of throwing out of lock()/unlock()
    // (never-throw §3.6). UNSUPPORTED_ERROR and real DOMException rejections already
    // carry a string message and take the fast path.
    _errorInfoMessage(error) {
        return typeof error?.message === "string" ? error.message : String(error);
    }
    // Called only from _setError (which already same-value-guards on the error
    // reference), so errorInfo transitions exactly when error does — no separate
    // guard needed here.
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-orientation:error-info-changed", {
            detail: info,
            bubbles: true,
        }));
    }
    // Same-value guard (§3.3 MUST): the native `change` event already fires only
    // on a real change, but this Core still verifies field-by-field before
    // dispatching — defense in depth against a browser quirk double-firing
    // `change` with identical values.
    _apply(next) {
        const prev = this._snapshot;
        if (prev.type === next.type && prev.angle === next.angle) {
            return;
        }
        this._snapshot = next;
        this._target.dispatchEvent(new CustomEvent("wcs-orientation:change", {
            detail: next,
            bubbles: true,
        }));
    }
}

/**
 * `<wcs-screen-orientation>` — declarative Screen Orientation API monitor +
 * command node.
 *
 * The Shell is as small as `<wcs-network>` (docs/screen-orientation-tag-design.md
 * §3, §10): no attributes at all. `screen.orientation` is a single global with
 * nothing to configure, unlike target-based nodes (`intersection`/`resize`) or
 * descriptor-based ones (`permission`). Unlike `network`, though, this Shell is
 * bidirectional: it also delegates the `lock()`/`unlock()` commands.
 */
class WcsScreenOrientation extends HTMLElement {
    // SSR (§4.4): observe() completes synchronously, but the Shell still exposes
    // connectedCallbackPromise so the state binder can await it uniformly across
    // all IO nodes before snapshotting.
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...ScreenOrientationCore.wcBindable,
        inputs: [],
        // Core の commands をそのまま継承（単一情報源）。network/permission と同型。
        commands: ScreenOrientationCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new ScreenOrientationCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-orientation:change": (d) => ({
                portrait: d.type?.startsWith("portrait") ?? false,
                landscape: d.type?.startsWith("landscape") ?? false,
            }),
            "wcs-orientation:error": (d) => ({ error: d != null }),
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
    get type() {
        return this._core.type;
    }
    get angle() {
        return this._core.angle;
    }
    get portrait() {
        return this._core.portrait;
    }
    get landscape() {
        return this._core.landscape;
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
    lock(orientation) {
        return this._core.lock(orientation);
    }
    unlock() {
        this._core.unlock();
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
    if (!customElements.get(config.tagNames.screenOrientation)) {
        customElements.define(config.tagNames.screenOrientation, WcsScreenOrientation);
    }
}

function bootstrapScreenOrientation(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { ScreenOrientationCore, WCS_SCREEN_ORIENTATION_ERROR_CODE, WcsScreenOrientation, bootstrapScreenOrientation, getConfig };
//# sourceMappingURL=index.esm.js.map

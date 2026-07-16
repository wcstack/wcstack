const _config = {
    autoTrigger: true,
    triggerAttribute: "data-storagetarget",
    tagNames: {
        storage: "wcs-storage",
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
    if (typeof partialConfig.autoTrigger === "boolean") {
        _config.autoTrigger = partialConfig.autoTrigger;
    }
    if (typeof partialConfig.triggerAttribute === "string") {
        _config.triggerAttribute = partialConfig.triggerAttribute;
    }
    if (partialConfig.tagNames) {
        // Validate each tagNames entry individually instead of a blanket
        // Object.assign: a non-string (e.g. { storage: undefined }) would otherwise
        // poison the config and make customElements.define(undefined, …) throw at
        // registration time. Mirrors the typeof guards on autoTrigger / triggerAttribute.
        for (const [key, value] of Object.entries(partialConfig.tagNames)) {
            if (typeof value === "string") {
                _config.tagNames[key] = value;
            }
        }
    }
    frozenConfig = null;
}

// Single source of truth for the custom event names dispatched by StorageCore /
// Storage. These names appear in two places that must stay in lock-step:
//   1. the `wcBindable.properties[].event` declarations (consumed by bind())
//   2. the `dispatchEvent(new CustomEvent(...))` calls that emit them
// Hard-coding the same string literal in both places risks a silent typo that
// makes bind() listen for an event no one ever fires. Referencing these
// constants from both sites keeps them in sync.
const STORAGE_EVENTS = {
    valueChanged: "wcs-storage:value-changed",
    loadingChanged: "wcs-storage:loading-changed",
    error: "wcs-storage:error",
    errorInfoChanged: "wcs-storage:error-info-changed",
    triggerChanged: "wcs-storage:trigger-changed",
};

/**
 * storageCapabilities.ts
 *
 * Storage node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。storage の load / save / remove は同期で互いに競合しないため lane は
 * 持たず、error taxonomy(errorInfo)のみを採用する。
 */
/** 安定した storage error code(taxonomy)。値は公開キーとして固定。 */
const WCS_STORAGE_ERROR_CODE = {
    /** `key` 未設定 / 不正な `type` などの入力不備。retry では回復しない。 */
    InvalidArgument: "invalid-argument",
    /** `QuotaExceededError` — 容量超過。空きを作れば回復しうる(環境要因)。 */
    QuotaExceeded: "quota-exceeded",
    /** `SecurityError` — storage アクセス拒否(cookie 無効 / third-party context 等)。retry では回復しない。 */
    NotAllowed: "not-allowed",
    /** その他の caught 例外。 */
    StorageError: "storage-error",
};
/**
 * storage の失敗を serializable な error taxonomy に写す。
 *
 * `name` は caught 例外の `Error.name`(load / save / remove の catch から渡る)。
 * 未指定(undefined)は inline 構築の validation error(不正 `type` / `key` 未設定)を意味し、
 * これは開始前の入力不備なので phase="start" / `invalid-argument` / recoverable=false。
 * caught 例外は実行中の失敗なので phase="execute"。`QuotaExceededError` は環境要因で
 * 空きを作れば回復しうる(recoverable=true)、`SecurityError` は retry で回復しない。
 */
function deriveStorageErrorInfo(error, name) {
    if (name === undefined) {
        return {
            code: WCS_STORAGE_ERROR_CODE.InvalidArgument,
            phase: "start",
            recoverable: false,
            message: error.message,
        };
    }
    if (name === "QuotaExceededError") {
        return { code: WCS_STORAGE_ERROR_CODE.QuotaExceeded, phase: "execute", recoverable: true, message: error.message };
    }
    if (name === "SecurityError") {
        return { code: WCS_STORAGE_ERROR_CODE.NotAllowed, phase: "execute", recoverable: false, message: error.message };
    }
    return { code: WCS_STORAGE_ERROR_CODE.StorageError, phase: "execute", recoverable: true, message: error.message };
}

class StorageCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "value", event: STORAGE_EVENTS.valueChanged, getter: (e) => e.detail },
            { name: "loading", event: STORAGE_EVENTS.loadingChanged },
            { name: "error", event: STORAGE_EVENTS.error },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output derived from `error` (invalid-argument / quota-exceeded
            // / not-allowed / storage-error); the existing `error` property/event are unchanged.
            // Fires wcs-storage:error-info-changed. No lane — load/save/remove don't compete.
            { name: "errorInfo", event: STORAGE_EVENTS.errorInfoChanged },
        ],
        inputs: [
            { name: "key" },
            { name: "type" },
        ],
        // load / save / remove are synchronous, so none carry the `async` hint.
        commands: [
            { name: "load" },
            { name: "save" },
            { name: "remove" },
        ],
    };
    _target;
    _value = null;
    _loading = false;
    _error = null;
    _errorInfo = null;
    _key = "";
    _type = "local";
    _storageListener = null;
    // Generation guard: bumped on dispose(). The cross-tab `storage` listener
    // captures the generation active when startSync() ran; a callback that fires
    // after dispose() (or a teardown→re-setup) has a stale gen and MUST NOT write
    // state to a torn-down element. A boolean flag is insufficient (dispose→observe
    // would let a stale listener slip through).
    _gen = 0;
    // SSR: storage access is synchronous, so there is no asynchronous probe to
    // await — readiness is immediate.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get ready() {
        return this._ready;
    }
    // Lifecycle (§3.5). Storage sync is command-driven (the Shell calls startSync()
    // from connectedCallback), so observe() is an idempotent no-op that resolves
    // once ready; dispose() tears down the cross-tab listener and invalidates any
    // in-flight listener callback.
    observe() {
        return this._ready;
    }
    dispose() {
        this._gen++;
        this.stopSync();
    }
    get value() {
        return this._value;
    }
    // Set the current value *without* persisting it. Persistence happens only via
    // save() / remove() / a cross-tab storage event. This setter exists so the
    // Shell (manual mode) can stage a value handed in via a `value` binding and
    // then commit it later with save()/trigger. It mirrors the value to observers
    // through the same `value-changed` event load()/save() use (CSBC: a Core value
    // change is observable), but it deliberately does not touch storage.
    //
    // Same-value writes are skipped to break a potential feedback loop:
    // value-changed → state binding → value setter → value-changed → …
    set value(v) {
        if (Object.is(v, this._value))
            return;
        this._setValue(v);
    }
    get loading() {
        return this._loading;
    }
    get error() {
        return this._error;
    }
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-storage:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
    }
    get key() {
        return this._key;
    }
    set key(value) {
        // Defensive normalization for direct Core use (the Shell already passes a
        // string via `getAttribute("key") || ""`). Coercing to String keeps a
        // non-string assignment from poisoning the cross-tab `e.key !== _key`
        // comparison; empty keys are still rejected at operation time.
        this._key = String(value);
    }
    get type() {
        return this._type;
    }
    set type(value) {
        if (value !== "local" && value !== "session") {
            // never-throw: an invalid type is routed to the error property and the
            // current type is kept (the safe default), rather than throwing out of the
            // setter / setAttribute / connectedCallback.
            this._setError({ operation: "type", message: `Invalid storage type: "${value}". Must be "local" or "session".` });
            return;
        }
        this._type = value;
    }
    _getStorage() {
        return this._type === "session" ? sessionStorage : localStorage;
    }
    _setLoading(loading) {
        this._loading = loading;
        this._target.dispatchEvent(new CustomEvent(STORAGE_EVENTS.loadingChanged, {
            detail: loading,
            bubbles: true,
        }));
    }
    // `name` is the caught exception's `Error.name` (passed only from the
    // load/save/remove catch blocks); it stays out of the public `error` shape and
    // is used solely to classify errorInfo (quota vs security vs generic). Inline
    // validation errors (invalid type / missing key) pass no name → invalid-argument.
    _setError(error, name) {
        // Same-value guard (async-io-node-guidelines.md §3.3). `error` is state-ish,
        // so suppressing redundant null→null dispatches (every load/save/remove start
        // clears a usually-already-null error) avoids a spurious error event per
        // successful operation. Reference identity is sufficient: each failure builds
        // a fresh object, and the clear path always passes null.
        if (this._error === error)
            return;
        this._error = error;
        // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the
        // error (or null on clear). Fires before the `error` event so an observer
        // binding both sees the classification first, mirroring the io-node family.
        this._commitErrorInfo(error === null ? null : deriveStorageErrorInfo(error, name));
        this._target.dispatchEvent(new CustomEvent(STORAGE_EVENTS.error, {
            detail: error,
            bubbles: true,
        }));
    }
    // Called only from _setError (which already same-value-guards on the error
    // reference), so errorInfo transitions exactly when error does — no separate
    // guard needed here.
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent(STORAGE_EVENTS.errorInfoChanged, {
            detail: info,
            bubbles: true,
        }));
    }
    // Wrap a caught storage exception into the documented WcsStorageError shape,
    // tagging it with the failing operation so consumers know which call failed.
    _toStorageError(operation, e) {
        return {
            operation,
            message: e instanceof Error ? e.message : String(e),
        };
    }
    // The caught exception's `Error.name` for errorInfo classification (quota vs
    // security vs generic), or "" for a non-Error throw (→ storage-error). Returning
    // a string (never undefined) keeps a caught exception in the execute phase; only
    // inline validation errors, which pass no name to _setError, become start-phase
    // invalid-argument. Single chokepoint so the ternary is covered in one place.
    _errName(e) {
        return e instanceof Error ? e.name : "";
    }
    _setValue(value) {
        this._value = value;
        this._target.dispatchEvent(new CustomEvent(STORAGE_EVENTS.valueChanged, {
            detail: value,
            bubbles: true,
        }));
    }
    load() {
        if (!this._key) {
            // never-throw: a missing key is routed to the error property and a
            // sanitized null is returned, rather than throwing.
            this._setError({ operation: "load", message: "key is required." });
            return null;
        }
        this._setLoading(true);
        this._setError(null);
        try {
            const storage = this._getStorage();
            const raw = storage.getItem(this._key);
            if (raw === null) {
                this._setValue(null);
            }
            else {
                try {
                    this._setValue(JSON.parse(raw));
                }
                catch {
                    this._setValue(raw);
                }
            }
            this._setLoading(false);
            return this._value;
        }
        catch (e) {
            this._setError(this._toStorageError("load", e), this._errName(e));
            this._setLoading(false);
            return null;
        }
    }
    save(value) {
        if (!this._key) {
            // never-throw: a missing key is routed to the error property instead of
            // throwing. No return value to sanitize (save returns void).
            this._setError({ operation: "save", message: "key is required." });
            return;
        }
        this._setLoading(true);
        this._setError(null);
        try {
            const storage = this._getStorage();
            if (value === null || value === undefined) {
                storage.removeItem(this._key);
                // Normalize the removed value to null (matching remove() and load() of a
                // missing key) so saving `undefined` does not leave the getter returning
                // `undefined`. README's serialization table documents null/undefined as
                // "null" on read-back.
                this._setValue(null);
            }
            else if (typeof value === "string") {
                storage.setItem(this._key, value);
                this._setValue(value);
            }
            else {
                storage.setItem(this._key, JSON.stringify(value));
                this._setValue(value);
            }
            this._setLoading(false);
        }
        catch (e) {
            this._setError(this._toStorageError("save", e), this._errName(e));
            this._setLoading(false);
        }
    }
    remove() {
        if (!this._key) {
            // never-throw: a missing key is routed to the error property instead of
            // throwing. No return value to sanitize (remove returns void).
            this._setError({ operation: "remove", message: "key is required." });
            return;
        }
        this._setLoading(true);
        this._setError(null);
        try {
            const storage = this._getStorage();
            storage.removeItem(this._key);
            this._setValue(null);
            this._setLoading(false);
        }
        catch (e) {
            this._setError(this._toStorageError("remove", e), this._errName(e));
            this._setLoading(false);
        }
    }
    startSync() {
        if (this._storageListener)
            return;
        // Capture the generation active when sync starts. A `storage` event that
        // fires after dispose() (which bumps _gen and removes the listener) carries a
        // stale gen and must not write state to a torn-down element. stopSync()
        // already detaches the listener, but the gen guard also covers a queued event
        // delivered between dispose()'s bump and the actual removeEventListener.
        const gen = ++this._gen;
        this._storageListener = (e) => {
            if (gen !== this._gen)
                return;
            if (e.key !== this._key)
                return;
            if (this._type === "session")
                return;
            // A fresh value arriving from another tab supersedes any stale error from
            // a prior failed load/save/remove. Clearing it here keeps the sync path
            // consistent with load()/save()/remove(), which all reset error to null at
            // the start of a successful operation — otherwise an "error present + fresh
            // value" inconsistency could persist after a cross-tab update.
            this._setError(null);
            if (e.newValue === null) {
                this._setValue(null);
            }
            else {
                try {
                    this._setValue(JSON.parse(e.newValue));
                }
                catch {
                    this._setValue(e.newValue);
                }
            }
        };
        globalThis.addEventListener("storage", this._storageListener);
    }
    stopSync() {
        if (!this._storageListener)
            return;
        globalThis.removeEventListener("storage", this._storageListener);
        this._storageListener = null;
    }
}

let registered = false;
function handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element))
        return;
    const triggerElement = target.closest(`[${config.triggerAttribute}]`);
    if (!triggerElement)
        return;
    const storageId = triggerElement.getAttribute(config.triggerAttribute);
    if (!storageId)
        return;
    // Resolve the registered constructor at call time instead of importing Storage
    // as a value. The value import created a components/Storage.ts ⇄ autoTrigger.ts
    // cycle (Storage.connectedCallback() calls registerAutoTrigger()). instanceof
    // against the customElements registry keeps the exact same identity guarantee
    // — only the registered <wcs-storage> class matches — without the import cycle.
    const StorageCtor = customElements.get(config.tagNames.storage);
    const storageElement = document.getElementById(storageId);
    if (!StorageCtor || !(storageElement instanceof StorageCtor))
        return;
    event.preventDefault();
    storageElement.save();
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

class Storage extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...StorageCore.wcBindable,
        properties: [
            ...StorageCore.wcBindable.properties,
            { name: "trigger", event: STORAGE_EVENTS.triggerChanged },
        ],
        // Shell-level input surface. The Core declares only the portable `key` / `type`;
        // the Shell adds the DOM-driven settable surface. No `attribute` hints are given:
        // the `key` / `type` / `manual` setters already reflect to their attributes, so a
        // binding system that mirrors inputs[].attribute would set the attribute twice
        // (`value` / `trigger` are not attribute-backed). `commands` (load / save / remove)
        // are inherited unchanged from the Core via the spread above.
        inputs: [
            { name: "key" },
            { name: "type" },
            { name: "value" },
            { name: "manual" },
            { name: "trigger" },
        ],
    };
    static get observedAttributes() { return ["key", "type"]; }
    _core;
    _trigger = false;
    // Storage load()/save() are synchronous, so connection work never defers.
    // This stays an already-resolved Promise for the whole lifecycle; it exists
    // only to satisfy the `hasConnectedCallbackPromise` protocol (consumers may
    // `await el.connectedCallbackPromise`). connectedCallback intentionally does
    // not reassign it — there is nothing async to wait for, unlike <wcs-fetch>.
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new StorageCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            [STORAGE_EVENTS.loadingChanged]: (d) => ({ loading: d === true }),
            [STORAGE_EVENTS.error]: (d) => ({ error: d != null }),
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
    // Push the Shell's current attribute-derived key / type down into the Core.
    // Every operation (load / save / remove / value setter) and every lifecycle
    // hook that may run a Core operation or cross-tab sync must do this first, so
    // the Core never acts on a stale key / type. Centralizing it here avoids the
    // previous pattern of repeating `_core.key = …; _core.type = …;` at each call
    // site, which risked a future call site forgetting one of the two.
    _syncCore() {
        this._core.key = this.key;
        this._core.type = this.type;
    }
    get key() {
        return this.getAttribute("key") || "";
    }
    set key(value) {
        this.setAttribute("key", value);
    }
    get type() {
        // Normalize at the Shell boundary: any attribute value other than the
        // exact "session" falls back to "local". This keeps an invalid attribute
        // (e.g. type="foo") from reaching the Core's validating setter and throwing
        // out of setAttribute / connectedCallback.
        return this.getAttribute("type") === "session" ? "session" : "local";
    }
    set type(value) {
        this.setAttribute("type", value);
    }
    get value() {
        return this._core.value;
    }
    set value(v) {
        // Non-manual mode: assigning `value` auto-saves the *assigned* argument `v`
        // (write-through). Note this differs from save()/trigger, which persist the
        // *current* `_core.value` (which load() or a cross-tab `storage` event may
        // have updated). See README "Design Notes" for the rationale.
        //
        // Manual mode: assigning `value` does NOT persist — it only stages the value
        // into the Core (no storage write). This keeps the getter/setter consistent
        // (`el.value = x; el.value === x`) and lets a later save()/trigger commit the
        // staged value, so a `value: …` + `trigger: …` binding pair works as
        // documented. The actual write still happens only via save()/trigger.
        if (!this.manual) {
            this._syncCore();
            this._core.save(v);
        }
        else {
            this._core.value = v;
        }
    }
    get loading() {
        return this._core.loading;
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
    get manual() {
        return this.hasAttribute("manual");
    }
    set manual(value) {
        if (value) {
            this.setAttribute("manual", "");
        }
        else {
            this.removeAttribute("manual");
        }
    }
    get trigger() {
        return this._trigger;
    }
    set trigger(value) {
        const v = !!value;
        if (v) {
            this._trigger = true;
            // save() is never-throw (a failure — e.g. key unset — is routed to the
            // `error` property, not thrown), but the try/finally is kept defensively
            // to guarantee the trigger resets to false and the completion event fires
            // even in the unexpected event of a throw, so the trigger never gets stuck
            // in the `true` state.
            try {
                this.save();
            }
            finally {
                this._trigger = false;
                this.dispatchEvent(new CustomEvent(STORAGE_EVENTS.triggerChanged, {
                    detail: false,
                    bubbles: true,
                }));
            }
        }
    }
    load() {
        this._syncCore();
        return this._core.load();
    }
    // The `save` command differs in arity between the two CSBC surfaces:
    // - Core:  save(value)  — caller supplies the value to persist
    // - Shell: save()       — persists the current `_core.value` (no argument)
    // Both are exposed under the same `commands` entry name "save". The protocol
    // `commands` list is descriptive metadata only and carries no arity, so this
    // is not a protocol violation; the difference is contractual and documented
    // in the README ("Design Notes").
    save() {
        this._syncCore();
        this._core.save(this._core.value);
    }
    remove() {
        this._syncCore();
        this._core.remove();
    }
    attributeChangedCallback(name, _oldValue, newValue) {
        if (!this.isConnected)
            return;
        if (name === "key") {
            // Always keep the Core's key in sync with the attribute, regardless of
            // mode or whether the new value is empty. The cross-tab `storage` listener
            // compares `e.key !== _core.key`, so a stale Core key would make sync watch
            // the wrong (old/empty) key after a runtime key change. load() (which also
            // syncs the Core) only runs for non-manual mode with a non-empty key.
            this._syncCore();
            if (newValue && !this.manual) {
                this.load();
            }
        }
        if (name === "type") {
            // Route through the normalizing getter so an invalid attribute value
            // (e.g. type="foo") falls back to "local" instead of throwing.
            this._syncCore();
        }
    }
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        if (!this.manual && this.key) {
            this.load();
        }
        // Always bind the cross-tab watcher to the Shell's current key/type before
        // starting sync. In paths where load()/save() never run (e.g. manual mode,
        // or key set via JS without a load), _core.key/_core.type would otherwise
        // keep a stale/empty value and the storage listener's `e.key !== _key`
        // check would compare against the wrong key. This also covers detach →
        // re-attach: stale Core key from a previous session is overwritten here.
        this._syncCore();
        this._core.startSync();
    }
    disconnectedCallback() {
        this._core.stopSync();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.storage)) {
        customElements.define(config.tagNames.storage, Storage);
    }
}

function bootstrapStorage(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { StorageCore, WCS_STORAGE_ERROR_CODE, Storage as WcsStorage, bootstrapStorage, getConfig };
//# sourceMappingURL=index.esm.js.map

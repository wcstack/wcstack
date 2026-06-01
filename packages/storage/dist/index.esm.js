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
    triggerChanged: "wcs-storage:trigger-changed",
};

function raiseError(message) {
    throw new Error(`[@wcstack/storage] ${message}`);
}

class StorageCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "value", event: STORAGE_EVENTS.valueChanged, getter: (e) => e.detail },
            { name: "loading", event: STORAGE_EVENTS.loadingChanged },
            { name: "error", event: STORAGE_EVENTS.error },
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
    _key = "";
    _type = "local";
    _storageListener = null;
    constructor(target) {
        super();
        this._target = target ?? this;
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
            raiseError(`Invalid storage type: "${value}". Must be "local" or "session".`);
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
    _setError(error) {
        this._error = error;
        this._target.dispatchEvent(new CustomEvent(STORAGE_EVENTS.error, {
            detail: error,
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
    _setValue(value) {
        this._value = value;
        this._target.dispatchEvent(new CustomEvent(STORAGE_EVENTS.valueChanged, {
            detail: value,
            bubbles: true,
        }));
    }
    load() {
        if (!this._key) {
            raiseError("key is required.");
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
            this._setError(this._toStorageError("load", e));
            this._setLoading(false);
            return null;
        }
    }
    save(value) {
        if (!this._key) {
            raiseError("key is required.");
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
            this._setError(this._toStorageError("save", e));
            this._setLoading(false);
        }
    }
    remove() {
        if (!this._key) {
            raiseError("key is required.");
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
            this._setError(this._toStorageError("remove", e));
            this._setLoading(false);
        }
    }
    startSync() {
        if (this._storageListener)
            return;
        this._storageListener = (e) => {
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
    constructor() {
        super();
        this._core = new StorageCore(this);
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
            // save() may raise (e.g. key unset). Guarantee the trigger resets to
            // false and the completion event fires even on failure, so the trigger
            // never gets stuck in the `true` state.
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

export { StorageCore, Storage as WcsStorage, bootstrapStorage, getConfig };
//# sourceMappingURL=index.esm.js.map

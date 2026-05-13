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
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    frozenConfig = null;
}

function raiseError(message) {
    throw new Error(`[@wcstack/storage] ${message}`);
}

class StorageCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "value", event: "wcs-storage:value-changed", getter: (e) => e.detail },
            { name: "loading", event: "wcs-storage:loading-changed" },
            { name: "error", event: "wcs-storage:error" },
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
        this._key = value;
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
        this._target.dispatchEvent(new CustomEvent("wcs-storage:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    _setError(error) {
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-storage:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _setValue(value) {
        this._value = value;
        this._target.dispatchEvent(new CustomEvent("wcs-storage:value-changed", {
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
            this._setError(e);
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
            }
            else if (typeof value === "string") {
                storage.setItem(this._key, value);
            }
            else {
                storage.setItem(this._key, JSON.stringify(value));
            }
            this._setValue(value);
            this._setLoading(false);
        }
        catch (e) {
            this._setError(e);
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
            this._setError(e);
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
    const storageElement = document.getElementById(storageId);
    if (!storageElement || !(storageElement instanceof Storage))
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
            { name: "trigger", event: "wcs-storage:trigger-changed" },
        ],
    };
    static get observedAttributes() { return ["key", "type"]; }
    _core;
    _trigger = false;
    _connectedCallbackPromise = Promise.resolve();
    constructor() {
        super();
        this._core = new StorageCore(this);
    }
    get key() {
        return this.getAttribute("key") || "";
    }
    set key(value) {
        this.setAttribute("key", value);
    }
    get type() {
        return this.getAttribute("type") || "local";
    }
    set type(value) {
        this.setAttribute("type", value);
    }
    get value() {
        return this._core.value;
    }
    set value(v) {
        if (!this.manual) {
            this._core.key = this.key;
            this._core.type = this.type;
            this._core.save(v);
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
            this.save();
            this._trigger = false;
            this.dispatchEvent(new CustomEvent("wcs-storage:trigger-changed", {
                detail: false,
                bubbles: true,
            }));
        }
    }
    load() {
        this._core.key = this.key;
        this._core.type = this.type;
        return this._core.load();
    }
    save() {
        this._core.key = this.key;
        this._core.type = this.type;
        this._core.save(this._core.value);
    }
    remove() {
        this._core.key = this.key;
        this._core.type = this.type;
        this._core.remove();
    }
    attributeChangedCallback(name, _oldValue, newValue) {
        if (!this.isConnected)
            return;
        if (name === "key" && newValue && !this.manual) {
            this.load();
        }
        if (name === "type") {
            this._core.type = newValue || "local";
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
        this._core.startSync();
        this._connectedCallbackPromise = Promise.resolve();
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

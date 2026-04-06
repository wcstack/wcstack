const _config = {
    autoTrigger: true,
    triggerAttribute: "data-uploadtarget",
    tagNames: {
        upload: "wcs-upload",
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
    throw new Error(`[@wcstack/upload] ${message}`);
}

class UploadCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "value", event: "wcs-upload:response", getter: (e) => e.detail.value },
            { name: "loading", event: "wcs-upload:loading-changed" },
            { name: "progress", event: "wcs-upload:progress" },
            { name: "error", event: "wcs-upload:error" },
            { name: "status", event: "wcs-upload:response", getter: (e) => e.detail.status },
        ],
    };
    _target;
    _value = null;
    _loading = false;
    _progress = 0;
    _error = null;
    _status = 0;
    _xhr = null;
    _promise = Promise.resolve(null);
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
    get progress() {
        return this._progress;
    }
    get error() {
        return this._error;
    }
    get status() {
        return this._status;
    }
    get promise() {
        return this._promise;
    }
    // --- State setters with event dispatch ---
    _setLoading(loading) {
        this._loading = loading;
        this._target.dispatchEvent(new CustomEvent("wcs-upload:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    _setProgress(progress) {
        this._progress = progress;
        this._target.dispatchEvent(new CustomEvent("wcs-upload:progress", {
            detail: progress,
            bubbles: true,
        }));
    }
    _setError(error) {
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-upload:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _setResponse(value, status) {
        this._value = value;
        this._status = status;
        this._target.dispatchEvent(new CustomEvent("wcs-upload:response", {
            detail: { value, status },
            bubbles: true,
        }));
    }
    // --- Public API ---
    abort() {
        if (this._xhr) {
            this._xhr.abort();
            this._xhr = null;
        }
    }
    upload(url, files, options = {}) {
        if (!url) {
            raiseError("url is required.");
        }
        if (!files || files.length === 0) {
            raiseError("files are required.");
        }
        const p = this._doUpload(url, files, options);
        this._promise = p;
        return p;
    }
    // --- Internal ---
    _doUpload(url, files, options) {
        // 既存のアップロードを中止
        this.abort();
        this._setLoading(true);
        this._setProgress(0);
        this._error = null;
        const { method = "POST", headers = {}, fieldName = "file", } = options;
        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append(fieldName, files[i]);
        }
        return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            this._xhr = xhr;
            xhr.upload.addEventListener("progress", (event) => {
                if (event.lengthComputable) {
                    const percent = Math.round((event.loaded / event.total) * 100);
                    this._setProgress(percent);
                }
            });
            xhr.addEventListener("load", () => {
                this._xhr = null;
                this._status = xhr.status;
                if (xhr.status >= 200 && xhr.status < 300) {
                    let value = xhr.responseText;
                    const contentType = xhr.getResponseHeader("Content-Type") || "";
                    if (contentType.includes("application/json")) {
                        try {
                            value = JSON.parse(xhr.responseText);
                        }
                        catch {
                            // テキストのまま
                        }
                    }
                    this._setProgress(100);
                    this._setResponse(value, xhr.status);
                    this._setLoading(false);
                    resolve(value);
                }
                else {
                    const error = {
                        status: xhr.status,
                        statusText: xhr.statusText,
                        body: xhr.responseText,
                    };
                    this._setError(error);
                    this._setLoading(false);
                    resolve(null);
                }
            });
            xhr.addEventListener("error", () => {
                this._xhr = null;
                this._setError({ message: "Network error" });
                this._setLoading(false);
                resolve(null);
            });
            xhr.addEventListener("abort", () => {
                this._xhr = null;
                this._setLoading(false);
                resolve(null);
            });
            xhr.open(method, url);
            for (const [name, value] of Object.entries(headers)) {
                xhr.setRequestHeader(name, value);
            }
            xhr.send(formData);
        });
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
    const uploadId = triggerElement.getAttribute(config.triggerAttribute);
    if (!uploadId)
        return;
    const uploadElement = document.getElementById(uploadId);
    if (!uploadElement || !(uploadElement instanceof WcsUpload))
        return;
    // ファイルと URL が揃っている場合のみ既定動作を抑止
    if (uploadElement.files && uploadElement.files.length > 0 && uploadElement.url) {
        event.preventDefault();
    }
    uploadElement.upload();
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

class WcsUpload extends HTMLElement {
    static hasConnectedCallbackPromise = false;
    static wcBindable = {
        ...UploadCore.wcBindable,
        properties: [
            ...UploadCore.wcBindable.properties,
            { name: "trigger", event: "wcs-upload:trigger-changed" },
            { name: "files", event: "wcs-upload:files-changed" },
        ],
    };
    static get observedAttributes() { return ["url"]; }
    _core;
    _files = null;
    _trigger = false;
    constructor() {
        super();
        this._core = new UploadCore(this);
    }
    // --- Attribute accessors ---
    get url() {
        return this.getAttribute("url") || "";
    }
    set url(value) {
        this.setAttribute("url", value);
    }
    get method() {
        return (this.getAttribute("method") || "POST").toUpperCase();
    }
    set method(value) {
        this.setAttribute("method", value);
    }
    get fieldName() {
        return this.getAttribute("field-name") || "file";
    }
    set fieldName(value) {
        this.setAttribute("field-name", value);
    }
    get multiple() {
        return this.hasAttribute("multiple");
    }
    set multiple(value) {
        if (value) {
            this.setAttribute("multiple", "");
        }
        else {
            this.removeAttribute("multiple");
        }
    }
    get maxSize() {
        const attr = this.getAttribute("max-size");
        return attr ? parseInt(attr, 10) : Infinity;
    }
    set maxSize(value) {
        this.setAttribute("max-size", String(value));
    }
    get accept() {
        return this.getAttribute("accept") || "";
    }
    set accept(value) {
        this.setAttribute("accept", value);
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
    // --- Core delegated getters ---
    get value() {
        return this._core.value;
    }
    get loading() {
        return this._core.loading;
    }
    get progress() {
        return this._core.progress;
    }
    get error() {
        return this._core.error;
    }
    get status() {
        return this._core.status;
    }
    get promise() {
        return this._core.promise;
    }
    // --- Command properties ---
    get trigger() {
        return this._trigger;
    }
    set trigger(value) {
        const v = !!value;
        if (v) {
            this._trigger = true;
            this.upload().finally(() => {
                this._trigger = false;
                this.dispatchEvent(new CustomEvent("wcs-upload:trigger-changed", {
                    detail: false,
                    bubbles: true,
                }));
            });
        }
    }
    get files() {
        return this._files;
    }
    set files(value) {
        this._files = value;
        this.dispatchEvent(new CustomEvent("wcs-upload:files-changed", {
            detail: value,
            bubbles: true,
        }));
        if (!this.manual && this.url && value && value.length > 0) {
            this.upload();
        }
    }
    // --- Validation ---
    _validate(files) {
        const maxSize = this.maxSize;
        if (maxSize !== Infinity) {
            for (let i = 0; i < files.length; i++) {
                if (files[i].size > maxSize) {
                    return { message: `File "${files[i].name}" exceeds maximum size of ${maxSize} bytes.` };
                }
            }
        }
        const accept = this.accept;
        if (accept) {
            const acceptList = accept.split(",").map(s => s.trim().toLowerCase());
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileType = file.type.toLowerCase();
                const fileName = file.name.toLowerCase();
                const matched = acceptList.some(pattern => {
                    if (pattern.startsWith(".")) {
                        return fileName.endsWith(pattern);
                    }
                    if (pattern.endsWith("/*")) {
                        return fileType.startsWith(pattern.slice(0, -1));
                    }
                    return fileType === pattern;
                });
                if (!matched) {
                    return { message: `File "${file.name}" does not match accepted types: ${accept}` };
                }
            }
        }
        return null;
    }
    // --- Public methods ---
    abort() {
        this._core.abort();
    }
    async upload() {
        const files = this._files;
        if (!files || files.length === 0) {
            return null;
        }
        const validationError = this._validate(files);
        if (validationError) {
            this.dispatchEvent(new CustomEvent("wcs-upload:error", {
                detail: validationError,
                bubbles: true,
            }));
            return null;
        }
        const result = await this._core.upload(this.url, files, {
            method: this.method,
            fieldName: this.fieldName,
        });
        // 自分が開始したアップロードのファイルだけをリセット
        // （途中で新しい files がセットされていたら触らない）
        if (this._files === files) {
            this._files = null;
            this.dispatchEvent(new CustomEvent("wcs-upload:files-changed", {
                detail: null,
                bubbles: true,
            }));
        }
        return result;
    }
    // --- Lifecycle ---
    attributeChangedCallback(_name, _oldValue, _newValue) {
        // URL変更ではアップロードを自動実行しない（ファイルが必要なため）
    }
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
    }
    disconnectedCallback() {
        this._core.abort();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.upload)) {
        customElements.define(config.tagNames.upload, WcsUpload);
    }
}

function bootstrapUpload(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { UploadCore, WcsUpload, bootstrapUpload, getConfig };
//# sourceMappingURL=index.esm.js.map

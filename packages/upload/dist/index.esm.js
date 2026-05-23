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
// `config` は内部用のライブビュー（live view）。setConfig() の更新が即座に反映される
// 実体 `_config` をそのまま公開しており、凍結もクローンもしていない。autoTrigger /
// components など同パッケージ内のモジュールが最新値を読むための窓口であり、
// 「変更不可なスナップショット」が必要な外部利用には getConfig()（凍結クローンを返す）
// を使うこと。型が readonly なのは内部からの誤書き換えを抑止するための表明にすぎない。
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
        inputs: [
            { name: "url" },
            { name: "method" },
            { name: "fieldName" },
        ],
        commands: [
            { name: "upload", async: true },
            { name: "abort" },
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
        // `_xhr` は send() の直前に同期で代入されるため、send 前に外部から abort が
        // 割り込む余地はない（割り込み点となる await が存在しない）。よって XHR.abort()
        // は常に進行中のリクエストに対して呼ばれ、abort イベントが発火して loading を
        // 解除する。loading の解除を abort イベントハンドラに集約しているのは、
        // ネットワークエラー/HTTP エラー/正常完了/中断のすべてで解除経路を一本化し、
        // FetchCore.abort() と挙動を揃えるため。
        if (this._xhr) {
            this._xhr.abort();
            this._xhr = null;
        }
    }
    async upload(url, files, options = {}) {
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
        this._setError(null);
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
        // Shell-level input surface. The Core declares only the portable `url` / `method` /
        // `fieldName`; the Shell adds the DOM-driven settable surface. No `attribute` hints
        // are given: the `url` / `method` / `fieldName` / `multiple` / `maxSize` / `accept` /
        // `manual` setters already reflect to their attributes, so a binding system that
        // mirrors inputs[].attribute would set the attribute twice (`files` / `trigger` are
        // not attribute-backed). `commands` (upload / abort) are inherited unchanged from the
        // Core via the spread above.
        inputs: [
            { name: "url" },
            { name: "method" },
            { name: "fieldName" },
            { name: "multiple" },
            { name: "maxSize" },
            { name: "accept" },
            { name: "manual" },
            { name: "files" },
            { name: "trigger" },
        ],
    };
    // `url` を観測するのは FetchCore のシェルと構造を揃えるためだが、upload は
    // url 変更だけでは送信できない（files が必須）。そのため attributeChangedCallback は
    // 意図的に何もしない。url 変更で自動送信しないことは仕様であり、テストで担保している。
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
        if (attr === null) {
            return Infinity;
        }
        // 不正値（NaN になる "abc" など）や負数は「制限なし」(Infinity) として扱う。
        // NaN を返すと `size > NaN` が常に false になりサイズ検証が無言で無効化され、
        // 負数を返すと全ファイルが拒否されるため、いずれも安全側の Infinity に丸める。
        const n = parseInt(attr, 10);
        return Number.isFinite(n) && n >= 0 ? n : Infinity;
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
        // 進行中に再度 trigger=true が来ても再入ガードはしない（FetchCore シェルと同一）。
        // upload() → _core.upload() が先頭で既存リクエストを abort し新規開始するため、
        // 連続トリガは「前回を中止して新しいアップロードを開始する」挙動になる。
        // 各 upload() の settle ごとに trigger-changed(false) が 1 回発火する。
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
                // file.type が空文字（OS が MIME を判定できないファイル）の場合、MIME 系
                // パターン（`image/*` / 厳密 MIME）は一致しない。その場合でも accept に
                // 拡張子パターン（`.pdf` 等）が含まれ拡張子が一致すれば受理される。
                // accept が MIME 系のみのときは型を確認できないため拒否する（安全側）。
                const matched = acceptList.some(pattern => {
                    if (pattern.startsWith(".")) {
                        return fileName.endsWith(pattern);
                    }
                    if (pattern.endsWith("/*")) {
                        return fileType !== "" && fileType.startsWith(pattern.slice(0, -1));
                    }
                    return fileType !== "" && fileType === pattern;
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
        // url 未設定は no-op(null)。Core は url 空で throw するが、Shell は url/files の
        // ライフサイクルを所有しており「送信先が無い」を「ファイル無し」と同じ無操作として扱う。
        // これにより set trigger / set files の fire-and-forget 経路で unhandled rejection が
        // 発生せず、README の「upload() は全終了ケースで resolve し never reject」契約とも整合する。
        if (!files || files.length === 0 || !this.url) {
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
        // 意図的に空。url 変更ではアップロードを自動実行しない（files が必要なため）。
        // observedAttributes のコメント参照。
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

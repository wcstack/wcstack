const _config = {
    autoTrigger: true,
    triggerAttribute: "data-fetchtarget",
    tagNames: {
        fetch: "wcs-fetch",
        fetchHeader: "wcs-fetch-header",
        fetchBody: "wcs-fetch-body",
    },
};
const config = _config;
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
}

function raiseError(message) {
    throw new Error(`[@wcstack/fetch] ${message}`);
}

class FetchCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "value", event: "wcs-fetch:response" },
            { name: "loading", event: "wcs-fetch:loading-changed" },
            { name: "error", event: "wcs-fetch:error" },
            { name: "status", event: "wcs-fetch:response", getter: (e) => e.detail.status },
        ],
    };
    _target;
    _value = null;
    _loading = false;
    _error = null;
    _status = 0;
    _abortController = null;
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
    get status() {
        return this._status;
    }
    _setLoading(loading) {
        this._loading = loading;
        this._target.dispatchEvent(new CustomEvent("wcs-fetch:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    _setError(error) {
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-fetch:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _setResponse(value, status) {
        this._value = value;
        this._status = status;
        this._target.dispatchEvent(new CustomEvent("wcs-fetch:response", {
            detail: { value, status },
            bubbles: true,
        }));
    }
    abort() {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }
    async fetch(url, options = {}) {
        if (!url) {
            raiseError("url attribute is required.");
        }
        // 進行中のリクエストをキャンセル
        this.abort();
        this._abortController = new AbortController();
        const { signal } = this._abortController;
        this._setLoading(true);
        this._error = null;
        const { method = "GET", headers = {}, body = null, contentType = null, forceText = false, } = options;
        try {
            if (contentType && !headers["Content-Type"]) {
                headers["Content-Type"] = contentType;
            }
            const requestInit = {
                method,
                headers,
                signal,
            };
            if (method !== "GET" && method !== "HEAD" && body !== null) {
                requestInit.body = body;
            }
            const response = await globalThis.fetch(url, requestInit);
            this._status = response.status;
            if (!response.ok) {
                const errorBody = await response.text().catch(() => "");
                const error = { status: response.status, statusText: response.statusText, body: errorBody };
                this._setError(error);
                this._setLoading(false);
                return null;
            }
            if (forceText) {
                const text = await response.text();
                this._setResponse(text, response.status);
            }
            else {
                const responseContentType = response.headers.get("Content-Type") || "";
                if (responseContentType.includes("application/json")) {
                    const data = await response.json();
                    this._setResponse(data, response.status);
                }
                else {
                    const text = await response.text();
                    this._setResponse(text, response.status);
                }
            }
            this._setLoading(false);
            return this._value;
        }
        catch (e) {
            if (e.name === "AbortError") {
                this._setLoading(false);
                return null;
            }
            this._setError(e);
            this._setLoading(false);
            return null;
        }
        finally {
            this._abortController = null;
        }
    }
}

class Fetch extends HTMLElement {
    static wcBindable = FetchCore.wcBindable;
    _core;
    _body = null;
    constructor() {
        super();
        this._core = new FetchCore(this);
    }
    get url() {
        return this.getAttribute("url") || "";
    }
    set url(value) {
        this.setAttribute("url", value);
    }
    get method() {
        return (this.getAttribute("method") || "GET").toUpperCase();
    }
    set method(value) {
        this.setAttribute("method", value);
    }
    get target() {
        return this.getAttribute("target");
    }
    set target(value) {
        if (value === null) {
            this.removeAttribute("target");
        }
        else {
            this.setAttribute("target", value);
        }
    }
    get value() {
        return this._core.value;
    }
    get loading() {
        return this._core.loading;
    }
    get error() {
        return this._core.error;
    }
    get status() {
        return this._core.status;
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
    get body() {
        return this._body;
    }
    set body(value) {
        this._body = value;
    }
    _collectHeaders() {
        const headers = {};
        const headerElements = this.querySelectorAll(config.tagNames.fetchHeader);
        for (const el of headerElements) {
            const name = el.headerName;
            const value = el.headerValue;
            if (name) {
                headers[name] = value;
            }
        }
        return headers;
    }
    _collectBody() {
        // JS API経由のbodyが優先
        if (this._body !== null) {
            return {
                body: typeof this._body === "string" ? this._body : JSON.stringify(this._body),
                contentType: typeof this._body === "string" ? null : "application/json",
            };
        }
        // サブタグからbodyを取得
        const bodyElement = this.querySelector(config.tagNames.fetchBody);
        if (bodyElement) {
            return {
                body: bodyElement.bodyContent || null,
                contentType: bodyElement.contentType,
            };
        }
        return { body: null, contentType: null };
    }
    abort() {
        this._core.abort();
    }
    async fetch() {
        const headers = this._collectHeaders();
        const { body, contentType } = this._collectBody();
        const result = await this._core.fetch(this.url, {
            method: this.method,
            headers,
            body,
            contentType,
            forceText: !!this.target,
        });
        // HTML置換モード
        if (this.target && result !== null) {
            const targetElement = document.getElementById(this.target);
            if (targetElement) {
                targetElement.innerHTML = result;
            }
        }
        // bodyをリセット（一回限りの使用）
        this._body = null;
        return result;
    }
    connectedCallback() {
        this.style.display = "none";
        if (!this.manual && this.url) {
            this.fetch();
        }
    }
    disconnectedCallback() {
        this.abort();
    }
}

class FetchHeader extends HTMLElement {
    connectedCallback() {
        this.style.display = "none";
    }
    get headerName() {
        return this.getAttribute("name") || "";
    }
    get headerValue() {
        return this.getAttribute("value") || "";
    }
}

class FetchBody extends HTMLElement {
    constructor() {
        super();
        // スロットなしのShadow DOMでlight DOM（bodyテキスト）の描画を抑制
        this.attachShadow({ mode: "open" });
    }
    get contentType() {
        return this.getAttribute("type") || "application/json";
    }
    get bodyContent() {
        return this.textContent?.trim() || "";
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.fetch)) {
        customElements.define(config.tagNames.fetch, Fetch);
    }
    if (!customElements.get(config.tagNames.fetchHeader)) {
        customElements.define(config.tagNames.fetchHeader, FetchHeader);
    }
    if (!customElements.get(config.tagNames.fetchBody)) {
        customElements.define(config.tagNames.fetchBody, FetchBody);
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
    const fetchId = triggerElement.getAttribute(config.triggerAttribute);
    if (!fetchId)
        return;
    const fetchElement = document.getElementById(fetchId);
    if (!fetchElement || !(fetchElement instanceof Fetch))
        return;
    event.preventDefault();
    fetchElement.fetch();
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

function bootstrapFetch(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
    if (config.autoTrigger) {
        registerAutoTrigger();
    }
}

export { FetchCore, bootstrapFetch };
//# sourceMappingURL=index.esm.js.map

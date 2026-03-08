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

class Fetch extends HTMLElement {
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
    _value = null;
    _loading = false;
    _error = null;
    _status = 0;
    _body = null;
    _abortController = null;
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
    _setLoading(loading) {
        this._loading = loading;
        this.dispatchEvent(new CustomEvent("wcs-fetch:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    _setError(error) {
        this._error = error;
        this.dispatchEvent(new CustomEvent("wcs-fetch:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _setResponse(value, status) {
        this._value = value;
        this._status = status;
        this.dispatchEvent(new CustomEvent("wcs-fetch:response", {
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
    async fetch() {
        const url = this.url;
        if (!url) {
            raiseError("url attribute is required.");
        }
        // 進行中のリクエストをキャンセル
        this.abort();
        this._abortController = new AbortController();
        const { signal } = this._abortController;
        this._setLoading(true);
        this._error = null;
        try {
            const headers = this._collectHeaders();
            const { body, contentType } = this._collectBody();
            if (contentType && !headers["Content-Type"]) {
                headers["Content-Type"] = contentType;
            }
            const requestInit = {
                method: this.method,
                headers,
                signal,
            };
            if (this.method !== "GET" && this.method !== "HEAD" && body !== null) {
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
            const target = this.target;
            if (target) {
                // HTMLリプレースモード
                const html = await response.text();
                const targetElement = document.getElementById(target);
                if (targetElement) {
                    targetElement.innerHTML = html;
                }
                this._value = html;
                this._setResponse(html, response.status);
            }
            else {
                // JSONモード
                const contentType = response.headers.get("Content-Type") || "";
                if (contentType.includes("application/json")) {
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
            // bodyをリセット（一回限りの使用）
            this._body = null;
        }
    }
    disconnectedCallback() {
        this.abort();
    }
}

class FetchHeader extends HTMLElement {
    get headerName() {
        return this.getAttribute("name") || "";
    }
    get headerValue() {
        return this.getAttribute("value") || "";
    }
}

class FetchBody extends HTMLElement {
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

export { bootstrapFetch };
//# sourceMappingURL=index.esm.js.map

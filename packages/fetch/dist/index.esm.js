const _config = {
    autoTrigger: true,
    triggerAttribute: "data-fetchtarget",
    tagNames: {
        fetch: "wcs-fetch",
        fetchHeader: "wcs-fetch-header",
        fetchBody: "wcs-fetch-body",
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
    throw new Error(`[@wcstack/fetch] ${message}`);
}

class FetchCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "value", event: "wcs-fetch:response", getter: (e) => e.detail.value },
            { name: "loading", event: "wcs-fetch:loading-changed" },
            { name: "error", event: "wcs-fetch:error" },
            { name: "status", event: "wcs-fetch:response", getter: (e) => e.detail.status },
        ],
        inputs: [
            { name: "url" },
            { name: "method" },
        ],
        commands: [
            { name: "fetch", async: true },
            { name: "abort" },
        ],
    };
    _target;
    _value = null;
    _loading = false;
    _error = null;
    _status = 0;
    _abortController = null;
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
    get error() {
        return this._error;
    }
    get status() {
        return this._status;
    }
    get promise() {
        return this._promise;
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
        const p = this._doFetch(url, options);
        this._promise = p;
        return p;
    }
    async _doFetch(url, options) {
        // 進行中のリクエストをキャンセル
        this.abort();
        // Hold the controller in a local so the finally block (which can run after a
        // subsequent fetch has already replaced this._abortController) only clears the
        // field when it still owns it. Without the identity check, an aborted earlier
        // request's finally would null out the controller of the request that superseded
        // it, leaving the later request un-abortable.
        const ac = new AbortController();
        this._abortController = ac;
        const { signal } = ac;
        this._setLoading(true);
        this._setError(null);
        const { method = "GET", body = null, contentType = null, forceText = false, } = options;
        // Copy the caller's headers so the contentType injection below never mutates
        // the object passed in by a headless consumer (the Shell already builds a
        // fresh object, but direct FetchCore users may reuse theirs).
        const headers = { ...(options.headers ?? {}) };
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
            if (!response.ok) {
                const errorBody = await response.text().catch(() => "");
                const error = { status: response.status, statusText: response.statusText, body: errorBody };
                this._setError(error);
                // Notify `status` observers on HTTP errors too. The `status` property is
                // surfaced via the `wcs-fetch:response` event (getter reads detail.status),
                // so without dispatching it here a bind() subscriber would never see the
                // error status (404, 500, ...). `value` is reset to null on error.
                this._setResponse(null, response.status);
                this._setLoading(false);
                return null;
            }
            if (method === "HEAD") {
                // HEAD responses carry no body by spec. Reading it as JSON would throw a
                // parse error on the empty body (and end up as a spurious `error`), so skip
                // body reading entirely and surface only the status with a null value.
                this._setResponse(null, response.status);
            }
            else if (forceText) {
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
                // Suppress loading=false when a later request has already taken over. A
                // subsequent fetch() aborts this one via abort() (which nulls the field) and
                // then immediately installs its own controller, so `this._abortController` is
                // non-null here. That newer request has already emitted loading=true and is
                // still in flight, so emitting loading=false now would make observers see a
                // spurious flicker. An explicit abort() leaves the field null, so that path
                // still reports loading=false as expected.
                if (this._abortController === null) {
                    this._setLoading(false);
                }
                return null;
            }
            this._setError(e);
            // Reset value/status on network errors too, mirroring the HTTP-error path
            // (`_setResponse(null, response.status)`). Without this, a prior successful
            // request's value/status would linger while `error` is non-null, showing
            // observers an inconsistent state (e.g. status=200 alongside a network
            // error). status=0 is the web-platform convention for "no HTTP response"
            // (matches XMLHttpRequest.status on network failure) and the initial value.
            this._setResponse(null, 0);
            this._setLoading(false);
            return null;
        }
        finally {
            if (this._abortController === ac) {
                this._abortController = null;
            }
        }
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
    // Skip when the target has no url. fetch() is fire-and-forget here (its returned
    // promise is intentionally not awaited), and FetchCore.fetch() rejects synchronously
    // on an empty url. Without this guard that rejection would surface as an unhandled
    // promise rejection. Treat a url-less target as "nothing to do", consistent with the
    // other early returns above.
    if (!fetchElement.url)
        return;
    // Suppress the element's default action so a fetch can fire without navigating.
    // Intentional: do not attach data-fetchtarget to an element whose default action
    // you also want (real <a href> link, form-submit button) — it will be cancelled.
    // See README "Optional DOM Triggering".
    event.preventDefault();
    fetchElement.fetch();
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

class Fetch extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...FetchCore.wcBindable,
        properties: [
            ...FetchCore.wcBindable.properties,
            { name: "trigger", event: "wcs-fetch:trigger-changed" },
        ],
        // Shell-level input surface. The Core declares only the portable `url` / `method`;
        // the Shell adds the DOM-driven settable surface. No `attribute` hints are given:
        // these setters already reflect to their attributes themselves, so a binding system
        // that mirrors inputs[].attribute would set the attribute twice. `commands`
        // (fetch / abort) are inherited unchanged from the Core via the spread above.
        inputs: [
            { name: "url" },
            { name: "method" },
            { name: "target" },
            { name: "manual" },
            { name: "body" },
            { name: "trigger" },
        ],
    };
    static get observedAttributes() { return ["url"]; }
    _core;
    _body = null;
    _trigger = false;
    _connectedCallbackPromise = Promise.resolve();
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
    get promise() {
        return this._core.promise;
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
    get body() {
        return this._body;
    }
    set body(value) {
        this._body = value;
    }
    get trigger() {
        return this._trigger;
    }
    set trigger(value) {
        const v = !!value;
        if (v) {
            // Skip when url is empty. fetch() is fire-and-forget here (its returned
            // promise is intentionally only chained with .finally() to reset the flag,
            // never .catch()'d), and FetchCore.fetch() rejects on an empty url. Without
            // this guard that rejection — re-thrown by .finally() — surfaces as an
            // unhandled promise rejection. Mirrors the url-less guard in autoTrigger.
            //
            // Leave `_trigger` false (do not set it) and emit no event: nothing ran, so
            // surfacing a `wcs-fetch:trigger-changed` "completion" would lie to observers.
            // Keeping the flag false also avoids stalling — once url is provided, writing
            // `true` again is a real false→true transition that triggers the fetch.
            if (!this.url)
                return;
            this._trigger = true;
            this.fetch().finally(() => {
                this._trigger = false;
                this.dispatchEvent(new CustomEvent("wcs-fetch:trigger-changed", {
                    detail: false,
                    bubbles: true,
                }));
            });
        }
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
    _collectBody(bodySnapshot) {
        // JS API経由のbodyが優先
        if (bodySnapshot !== null) {
            return {
                body: typeof bodySnapshot === "string" ? bodySnapshot : JSON.stringify(bodySnapshot),
                contentType: typeof bodySnapshot === "string" ? null : "application/json",
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
        // Snapshot and reset `body` synchronously, before any await. The body is a
        // one-shot input; resetting it after the await (when another caller may have
        // already set a new body for the next request) would silently drop that value.
        const bodySnapshot = this._body;
        this._body = null;
        const { body, contentType } = this._collectBody(bodySnapshot);
        const result = await this._core.fetch(this.url, {
            method: this.method,
            headers,
            body,
            contentType,
            forceText: !!this.target,
        });
        // HTML置換モード
        // Security: the response is injected as raw innerHTML without sanitization.
        // This is an opt-in convenience for trusted fragments only; the primary,
        // recommended path is state-driven binding via @wcstack/state. Do not point
        // `target` at an untrusted endpoint (XSS risk). See README "HTML Replace Mode".
        if (this.target && result !== null) {
            const targetElement = document.getElementById(this.target);
            if (targetElement) {
                targetElement.innerHTML = result;
            }
        }
        return result;
    }
    attributeChangedCallback(name, _oldValue, newValue) {
        // Re-fetch on url changes, but intentionally do NOT update
        // `_connectedCallbackPromise`. Per the wc-bindable connectedCallbackPromise
        // protocol that promise represents the one-shot "connect-time initialization
        // is done" signal; it resolves once and is not re-armed for later url-driven
        // requests. Await `promise` if you need to track a specific re-fetch.
        if (name === "url" && this.isConnected && !this.manual && newValue) {
            this.fetch();
        }
    }
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        // Only the initial connect-time fetch is tracked by connectedCallbackPromise.
        if (!this.manual && this.url) {
            this._connectedCallbackPromise = this.fetch().then(() => { });
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

function bootstrapFetch(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { FetchCore, Fetch as WcsFetch, bootstrapFetch, getConfig };
//# sourceMappingURL=index.esm.js.map

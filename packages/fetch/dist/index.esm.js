const _config = {
    autoTrigger: true,
    triggerAttribute: "data-fetchtarget",
    tagNames: {
        fetch: "wcs-fetch",
        fetchHeader: "wcs-fetch-header",
        fetchBody: "wcs-fetch-body",
        infiniteScroll: "wcs-infinite-scroll",
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

class FetchCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "value", event: "wcs-fetch:response", getter: (e) => e.detail.value },
            { name: "loading", event: "wcs-fetch:loading-changed" },
            { name: "error", event: "wcs-fetch:error" },
            { name: "status", event: "wcs-fetch:response", getter: (e) => e.detail.status },
            // Managed object URL for a `responseType: "blob"` response (null otherwise).
            // The Core revokes the previous URL on each new response and on dispose, so
            // a consumer can bind it straight into <img src> without lifecycle glue.
            { name: "objectURL", event: "wcs-fetch:response", getter: (e) => e.detail.objectURL },
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
    _objectURL = null;
    _abortController = null;
    _promise = Promise.resolve(null);
    // Generation guard (§3.4): bumped on dispose() (and each fetch start). An
    // in-flight request that settles after dispose / a superseding start has a
    // stale `gen` and MUST NOT write state to a torn-down element. A boolean flag
    // is insufficient (dispose→observe would let stale work slip through).
    _gen = 0;
    // SSR (§3.8): no asynchronous probe to await, so readiness is immediate.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get ready() {
        return this._ready;
    }
    // Lifecycle (§3.5). Fetch is command-driven with no subscription to
    // establish, so observe() is an idempotent no-op that resolves once ready;
    // dispose() invalidates any in-flight request and aborts it.
    observe() {
        return this._ready;
    }
    dispose() {
        this._gen++;
        this.abort();
        // Release any outstanding blob object URL on teardown (the other revoke point
        // is _setResponse, which drops the previous URL when a new response arrives).
        if (this._objectURL !== null) {
            this._revokeObjectURL(this._objectURL);
            this._objectURL = null;
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
    get objectURL() {
        return this._objectURL;
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
    _setResponse(value, status, objectURL = null) {
        // Revoke the previous blob object URL before replacing it. Any new response
        // (success, HTTP error, or network error all funnel through here) supersedes
        // the prior one, so the old URL is no longer needed; this plus dispose()
        // revocation keeps blob downloads leak-free.
        if (this._objectURL !== null) {
            this._revokeObjectURL(this._objectURL);
        }
        this._objectURL = objectURL;
        this._value = value;
        this._status = status;
        this._target.dispatchEvent(new CustomEvent("wcs-fetch:response", {
            detail: { value, status, objectURL },
            bubbles: true,
        }));
    }
    // Object URL lifecycle for responseType: "blob". The Core owns the blob's
    // object URL (mirrors RecorderCore) so a consumer can bind `objectURL` straight
    // into <img src>/<a href> without managing createObjectURL/revokeObjectURL. Both
    // helpers tolerate environments without URL.createObjectURL (SSR / headless).
    _createObjectURL(blob) {
        if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
            return URL.createObjectURL(blob);
        }
        return null;
    }
    _revokeObjectURL(url) {
        if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
            URL.revokeObjectURL(url);
        }
    }
    abort() {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }
    async fetch(url, options = {}) {
        // never-throw (§3.6): 引数バリデーション失敗は例外ではなく error プロパティに
        // 流し、サニタイズ値(null)を返す。command-token 経路からの呼び出しが unhandled
        // rejection にならず、「fetch() は全終了ケースで resolve」契約とも整合する。
        if (!url) {
            this._setError({ message: "url attribute is required." });
            return null;
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
        // Capture the generation at async start (§3.4). A completion that runs after
        // dispose() (which bumps _gen) is stale and must not write state.
        const gen = ++this._gen;
        this._setLoading(true);
        this._setError(null);
        const { method = "GET", body = null, contentType = null, forceText = false, responseType = "auto", } = options;
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
            // A stale generation means dispose() (or a superseding fetch) ran while the
            // request was in flight. Drop the result without touching torn-down state.
            if (gen !== this._gen) {
                return null;
            }
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
                // HTML-replace mode (the Shell sets forceText when `target` is present)
                // always reads text and takes priority over responseType.
                const text = await response.text();
                this._setResponse(text, response.status);
            }
            else if (responseType === "blob") {
                const blob = await response.blob();
                // Publish a managed object URL alongside the Blob so consumers can bind it
                // directly into <img src> etc.
                this._setResponse(blob, response.status, this._createObjectURL(blob));
            }
            else if (responseType === "arrayBuffer") {
                const buffer = await response.arrayBuffer();
                this._setResponse(buffer, response.status);
            }
            else if (responseType === "text") {
                const text = await response.text();
                this._setResponse(text, response.status);
            }
            else if (responseType === "json") {
                const data = await response.json();
                this._setResponse(data, response.status);
            }
            else {
                // "auto" (default): sniff Content-Type — JSON when it says so, else text.
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
            // Stale completion (dispose / superseding fetch ran during a later await
            // such as response.json()). Drop the result without writing state.
            if (gen !== this._gen) {
                return null;
            }
            if (e.name === "AbortError") {
                // A matching generation means this is an explicit abort() of the current
                // request (a superseding fetch bumps _gen and is caught by the stale guard
                // above; dispose() likewise bumps _gen). Explicit abort clears loading so
                // observers leave the in-flight state.
                this._setLoading(false);
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
    // Resolve the registered constructor at call time instead of importing Fetch
    // as a value. The value import created a components/Fetch.ts ⇄ autoTrigger.ts
    // cycle (Fetch.connectedCallback() calls registerAutoTrigger()). instanceof
    // against the customElements registry keeps the exact same identity guarantee
    // — only the registered <wcs-fetch> class matches — without the import cycle.
    const FetchCtor = customElements.get(config.tagNames.fetch);
    const el = document.getElementById(fetchId);
    if (!FetchCtor || !(el instanceof FetchCtor))
        return;
    const fetchElement = el;
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
            { name: "responseType" },
            { name: "trigger" },
        ],
    };
    static get observedAttributes() { return ["url"]; }
    _core;
    _body = null;
    _trigger = false;
    _connectedCallbackPromise = Promise.resolve();
    // Auto-fetch coalescing state (see _scheduleAutoFetch).
    _autoPending = false;
    _connectResolve = null;
    _lastFetchedUrl = null;
    constructor() {
        super();
        this._core = new FetchCore(this);
    }
    // Input setters normalize null/undefined to attribute removal instead of
    // letting setAttribute stringify them ("undefined" url would auto-fetch
    // /undefined, "undefined" method is an invalid HTTP method). The binder
    // already skips undefined writes; this guards direct JS assignment too.
    get url() {
        return this.getAttribute("url") || "";
    }
    set url(value) {
        if (value == null) {
            this.removeAttribute("url");
        }
        else {
            this.setAttribute("url", value);
        }
    }
    get method() {
        return (this.getAttribute("method") || "GET").toUpperCase();
    }
    set method(value) {
        if (value == null) {
            this.removeAttribute("method");
        }
        else {
            this.setAttribute("method", value);
        }
    }
    get target() {
        return this.getAttribute("target");
    }
    set target(value) {
        if (value == null) {
            this.removeAttribute("target");
        }
        else {
            this.setAttribute("target", value);
        }
    }
    // Response body interpretation. Backed by the `response-type` attribute so it is
    // settable from HTML, JS, or a binding. An unknown value falls through to the
    // Core's "auto" branch. `target` (HTML-replace mode) overrides this.
    get responseType() {
        return this.getAttribute("response-type") || "auto";
    }
    set responseType(value) {
        if (value == null) {
            this.removeAttribute("response-type");
        }
        else {
            this.setAttribute("response-type", value);
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
    get objectURL() {
        return this._core.objectURL;
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
        // Normalize undefined to null: _collectBody treats "!== null" as "body was
        // provided", so a raw undefined would serialize as a JSON request body.
        this._body = value ?? null;
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
    // fetch がネイティブに扱える BodyInit か判定する。これらは JSON.stringify せず
    // 素通しし、Content-Type をブラウザに委ねる (FormData の multipart boundary、
    // Blob の type、URLSearchParams の application/x-www-form-urlencoded を自動付与
    // させるため、_collectBody は contentType に null を返す)。ReadableStream は
    // RequestInit.duplex: 'half' を要するため初版では対象外とし、従来どおり扱う。
    _isNativeBodyInit(value) {
        return value instanceof Blob // File は Blob のサブクラス
            || value instanceof FormData
            || value instanceof URLSearchParams
            || value instanceof ArrayBuffer
            || ArrayBuffer.isView(value); // TypedArray / DataView
    }
    _collectBody(bodySnapshot) {
        // JS API経由のbodyが優先
        if (bodySnapshot !== null) {
            // 文字列はそのまま。Content-Type はユーザーのヘッダ指定に委ねる。
            if (typeof bodySnapshot === "string") {
                return { body: bodySnapshot, contentType: null };
            }
            // ネイティブ BodyInit (Blob/File/FormData/URLSearchParams/ArrayBuffer/TypedArray)
            // は素通し。Content-Type はブラウザに委ねるため null を返す。
            if (this._isNativeBodyInit(bodySnapshot)) {
                return { body: bodySnapshot, contentType: null };
            }
            // それ以外のオブジェクトは JSON 化する。
            return { body: JSON.stringify(bodySnapshot), contentType: "application/json" };
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
    /**
     * Coalesce auto-fetch requests in the current task into a single microtask.
     *
     * Multiple synchronous input writes in the same tick — e.g. a `...` spread
     * writing `url` before `manual` — collapse into one decision made against the
     * FINAL element state, so the spread application order can no longer trigger a
     * stray fetch. The microtask re-reads `isConnected` / `manual` / `url` at fire
     * time; whatever was written last wins.
     *
     * Only the implicit auto-fetch (url attribute change, connect-time) is routed
     * here. Explicit triggers — the `trigger` setter, the `fetch` command, and
     * autoTrigger (data-fetchtarget clicks) — must fire immediately and stay on
     * their own synchronous paths.
     *
     * The connect-time promise (connectedCallbackPromise) is resolved here in
     * EVERY exit path, including the no-fetch branch, so awaiting it never hangs
     * when the final state turns out to be manual / url-less / disconnected.
     */
    _scheduleAutoFetch() {
        if (this._autoPending) {
            return;
        }
        this._autoPending = true;
        queueMicrotask(() => {
            this._autoPending = false;
            const resolveConnect = this._connectResolve;
            this._connectResolve = null;
            const url = this.url;
            // Same-value guard (Phase 4): skip a redundant auto-fetch for the url we
            // last fetched. A spread re-evaluation rewrites every input each cycle, so
            // the `url` setter calls setAttribute with an unchanged value and fires
            // attributeChangedCallback again; without this guard an unrelated state
            // change would refetch. Auto-path only — explicit fetch()/trigger/command
            // stay unconditional (a manual refresh of the same url must work), and
            // `_lastFetchedUrl` is reset on disconnect so a remount refetches.
            if (this.isConnected && !this.manual && url && url !== this._lastFetchedUrl) {
                // fetch() cannot reject here: FetchCore swallows network/HTTP errors and
                // only rejects on an empty url, which the `url` guard above rules out.
                this.fetch().finally(() => resolveConnect?.());
            }
            else {
                resolveConnect?.();
            }
        });
    }
    async fetch() {
        // Record the url for the auto-fetch same-value guard. Every fetch (explicit
        // included) updates it so a later auto-write of the same url is treated as a
        // no-op rather than a duplicate request.
        this._lastFetchedUrl = this.url;
        const headers = this._collectHeaders();
        // Snapshot and reset `body` synchronously, before any await. The body is a
        // one-shot input; resetting it after the await (when another caller may have
        // already set a new body for the next request) would silently drop that value.
        const bodySnapshot = this._body;
        this._body = null;
        const { body, contentType } = this._collectBody(bodySnapshot);
        // FormData に手動で Content-Type を付けると、ブラウザが付与するはずの multipart
        // boundary が失われてサーバー側でパースできなくなる。ヘッダはユーザー指定を
        // 尊重して素通しするが、この典型的な誤設定は警告する。
        if (body instanceof FormData &&
            Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
            console.warn("[@wcstack/fetch] A manual Content-Type header was set alongside a FormData body. " +
                "This drops the multipart boundary the browser adds automatically; remove the " +
                "Content-Type header (e.g. the <wcs-fetch-header>) to fix multipart uploads.");
        }
        const result = await this._core.fetch(this.url, {
            method: this.method,
            headers,
            body,
            contentType,
            forceText: !!this.target,
            responseType: this.responseType,
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
    attributeChangedCallback(name, _oldValue, _newValue) {
        // Re-fetch on url changes, but intentionally do NOT update
        // `_connectedCallbackPromise`. Per the wc-bindable connectedCallbackPromise
        // protocol that promise represents the one-shot "connect-time initialization
        // is done" signal; it resolves once and is not re-armed for later url-driven
        // requests. Await `promise` if you need to track a specific re-fetch.
        //
        // Defer the decision to a microtask (see _scheduleAutoFetch) instead of
        // fetching synchronously here: a `...` spread writes `url` before `manual`,
        // so a synchronous fetch would fire before `manual` is applied. The final
        // state (isConnected / manual / url) is re-read at microtask time.
        if (name === "url") {
            this._scheduleAutoFetch();
        }
    }
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        // Only the initial connect-time fetch is tracked by connectedCallbackPromise.
        // Arm a deferred here when an auto-fetch looks likely; the scheduled
        // microtask resolves it (in every exit path, so awaiting never hangs). The
        // actual fetch decision is re-evaluated at microtask time against the final
        // state, so a spread that sets `manual` after `url` still suppresses it.
        if (!this.manual && this.url) {
            this._connectedCallbackPromise = new Promise((resolve) => {
                this._connectResolve = resolve;
            });
        }
        this._scheduleAutoFetch();
    }
    disconnectedCallback() {
        this.abort();
        // Reset the same-value guard so a remount (reconnect with the same url)
        // refetches rather than being skipped as a duplicate.
        this._lastFetchedUrl = null;
        // Resolve any armed connect-time deferred before detaching. A synchronous
        // remove()→append() before the scheduled microtask fires would otherwise let
        // the second connectedCallback overwrite _connectResolve, orphaning the first
        // deferred and hanging any caller that already awaited connectedCallbackPromise.
        // Disconnection makes connect-time init moot, so resolving (never hanging) is
        // correct; the pending microtask then sees _connectResolve === null and no-ops.
        this._connectResolve?.();
        this._connectResolve = null;
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

class InfiniteScroll extends HTMLElement {
    static get observedAttributes() {
        return ["target", "root", "root-margin", "threshold", "disabled"];
    }
    _observer = null;
    _done = false;
    get target() {
        return this.getAttribute("target") || "";
    }
    set target(value) {
        this.setAttribute("target", value);
    }
    get root() {
        return this.getAttribute("root");
    }
    set root(value) {
        if (value === null) {
            this.removeAttribute("root");
        }
        else {
            this.setAttribute("root", value);
        }
    }
    get rootMargin() {
        return this.getAttribute("root-margin") || "0px";
    }
    set rootMargin(value) {
        this.setAttribute("root-margin", value);
    }
    get threshold() {
        const value = Number(this.getAttribute("threshold") ?? "0");
        return Number.isFinite(value) ? value : 0;
    }
    set threshold(value) {
        this.setAttribute("threshold", String(value));
    }
    get disabled() {
        return this.hasAttribute("disabled");
    }
    set disabled(value) {
        if (value) {
            this.setAttribute("disabled", "");
        }
        else {
            this.removeAttribute("disabled");
        }
    }
    get once() {
        return this.hasAttribute("once");
    }
    set once(value) {
        if (value) {
            this.setAttribute("once", "");
        }
        else {
            this.removeAttribute("once");
        }
    }
    connectedCallback() {
        this._observe();
    }
    disconnectedCallback() {
        this._disconnectObserver();
    }
    attributeChangedCallback() {
        if (this.isConnected) {
            this._observe();
        }
    }
    _observe() {
        this._disconnectObserver();
        if (this._done || this.disabled || !this.target || typeof IntersectionObserver === "undefined") {
            return;
        }
        this._observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                this._triggerFetch();
            }
        }, {
            root: this._resolveRoot(),
            rootMargin: this.rootMargin,
            threshold: this.threshold,
        });
        this._observer.observe(this);
    }
    _disconnectObserver() {
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
    }
    _resolveRoot() {
        if (!this.root)
            return null;
        return document.getElementById(this.root) || null;
    }
    _triggerFetch() {
        const target = document.getElementById(this.target);
        if (!(target instanceof Fetch)) {
            return;
        }
        if (target.loading) {
            return;
        }
        target.trigger = true;
        if (this.once) {
            this._done = true;
            this._disconnectObserver();
        }
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
    if (!customElements.get(config.tagNames.infiniteScroll)) {
        customElements.define(config.tagNames.infiniteScroll, InfiniteScroll);
    }
}

function bootstrapFetch(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { FetchCore, Fetch as WcsFetch, InfiniteScroll as WcsInfiniteScroll, bootstrapFetch, getConfig };
//# sourceMappingURL=index.esm.js.map

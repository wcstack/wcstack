const _config = {
    autoTrigger: true,
    triggerAttribute: "data-wstarget",
    tagNames: {
        ws: "wcs-ws",
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
    throw new Error(`[@wcstack/websocket] ${message}`);
}

class WebSocketCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "message", event: "wcs-ws:message" },
            { name: "connected", event: "wcs-ws:connected-changed" },
            { name: "loading", event: "wcs-ws:loading-changed" },
            { name: "error", event: "wcs-ws:error" },
            { name: "readyState", event: "wcs-ws:readystate-changed" },
        ],
    };
    _target;
    _ws = null;
    _message = null;
    _connected = false;
    _loading = false;
    _error = null;
    _readyState = WebSocket.CLOSED;
    // 自動再接続
    _autoReconnect = false;
    _reconnectInterval = 3000;
    _maxReconnects = Infinity;
    _reconnectCount = 0;
    _reconnectTimer = null;
    _url = "";
    _protocols = undefined;
    _intentionalClose = false;
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get message() {
        return this._message;
    }
    get connected() {
        return this._connected;
    }
    get loading() {
        return this._loading;
    }
    get error() {
        return this._error;
    }
    get readyState() {
        return this._readyState;
    }
    // --- State setters with event dispatch ---
    _setMessage(message) {
        this._message = message;
        this._target.dispatchEvent(new CustomEvent("wcs-ws:message", {
            detail: message,
            bubbles: true,
        }));
    }
    _setConnected(connected) {
        this._connected = connected;
        this._target.dispatchEvent(new CustomEvent("wcs-ws:connected-changed", {
            detail: connected,
            bubbles: true,
        }));
    }
    _setLoading(loading) {
        this._loading = loading;
        this._target.dispatchEvent(new CustomEvent("wcs-ws:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    _setError(error) {
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-ws:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _setReadyState(readyState) {
        this._readyState = readyState;
        this._target.dispatchEvent(new CustomEvent("wcs-ws:readystate-changed", {
            detail: readyState,
            bubbles: true,
        }));
    }
    // --- Public API ---
    connect(url, options = {}) {
        if (!url) {
            raiseError("url is required.");
        }
        // 既存の接続をクローズ
        this._intentionalClose = true;
        this._closeInternal();
        this._url = url;
        this._protocols = options.protocols;
        this._autoReconnect = options.autoReconnect ?? false;
        this._reconnectInterval = options.reconnectInterval ?? 3000;
        this._maxReconnects = options.maxReconnects ?? Infinity;
        this._reconnectCount = 0;
        this._intentionalClose = false;
        this._doConnect();
    }
    send(data) {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
            raiseError("WebSocket is not connected.");
        }
        this._ws.send(data);
    }
    close(code, reason) {
        this._intentionalClose = true;
        this._clearReconnectTimer();
        if (this._ws) {
            this._ws.close(code, reason);
        }
    }
    // --- Internal ---
    _doConnect() {
        this._setLoading(true);
        this._setError(null);
        try {
            this._ws = this._protocols
                ? new WebSocket(this._url, this._protocols)
                : new WebSocket(this._url);
        }
        catch (e) {
            this._setLoading(false);
            this._setError(e);
            return;
        }
        this._setReadyState(WebSocket.CONNECTING);
        this._ws.addEventListener("open", this._onOpen);
        this._ws.addEventListener("message", this._onMessage);
        this._ws.addEventListener("error", this._onError);
        this._ws.addEventListener("close", this._onClose);
    }
    _onOpen = () => {
        this._reconnectCount = 0;
        this._setLoading(false);
        this._setConnected(true);
        this._setReadyState(WebSocket.OPEN);
    };
    _onMessage = (event) => {
        let data = event.data;
        // JSONの自動パース
        if (typeof data === "string") {
            try {
                data = JSON.parse(data);
            }
            catch {
                // テキストのまま
            }
        }
        this._setMessage(data);
    };
    _onError = (event) => {
        this._setError(event);
    };
    _onClose = (event) => {
        this._removeListeners();
        this._ws = null;
        this._setConnected(false);
        this._setLoading(false);
        this._setReadyState(WebSocket.CLOSED);
        // 異常クローズ時の自動再接続（正常終了 1000 は除外）
        if (!this._intentionalClose && this._autoReconnect && event.code !== 1000 && this._reconnectCount < this._maxReconnects) {
            this._scheduleReconnect();
        }
    };
    _scheduleReconnect() {
        this._clearReconnectTimer();
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._reconnectCount++;
            this._doConnect();
        }, this._reconnectInterval);
    }
    _clearReconnectTimer() {
        if (this._reconnectTimer !== null) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }
    _removeListeners() {
        this._ws.removeEventListener("open", this._onOpen);
        this._ws.removeEventListener("message", this._onMessage);
        this._ws.removeEventListener("error", this._onError);
        this._ws.removeEventListener("close", this._onClose);
    }
    _closeInternal() {
        this._clearReconnectTimer();
        if (this._ws) {
            this._removeListeners();
            if (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING) {
                this._ws.close();
            }
            this._ws = null;
        }
        // 旧接続の状態をリセット（コンストラクタ例外時に stale 状態が残るのを防止）
        if (this._connected) {
            this._setConnected(false);
        }
        if (this._readyState !== WebSocket.CLOSED) {
            this._setReadyState(WebSocket.CLOSED);
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
    const wsId = triggerElement.getAttribute(config.triggerAttribute);
    if (!wsId)
        return;
    const wsElement = document.getElementById(wsId);
    if (!wsElement || !(wsElement instanceof WcsWebSocket))
        return;
    event.preventDefault();
    wsElement.connect();
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

class WcsWebSocket extends HTMLElement {
    static hasConnectedCallbackPromise = false;
    static wcBindable = {
        ...WebSocketCore.wcBindable,
        properties: [
            ...WebSocketCore.wcBindable.properties,
            { name: "trigger", event: "wcs-ws:trigger-changed" },
            { name: "send", event: "wcs-ws:send-changed" },
        ],
    };
    static get observedAttributes() { return ["url"]; }
    _core;
    _trigger = false;
    constructor() {
        super();
        this._core = new WebSocketCore(this);
    }
    // --- Attribute accessors ---
    get url() {
        return this.getAttribute("url") || "";
    }
    set url(value) {
        this.setAttribute("url", value);
    }
    get protocols() {
        return this.getAttribute("protocols") || "";
    }
    set protocols(value) {
        this.setAttribute("protocols", value);
    }
    get autoReconnect() {
        return this.hasAttribute("auto-reconnect");
    }
    set autoReconnect(value) {
        if (value) {
            this.setAttribute("auto-reconnect", "");
        }
        else {
            this.removeAttribute("auto-reconnect");
        }
    }
    get reconnectInterval() {
        const attr = this.getAttribute("reconnect-interval");
        return attr ? parseInt(attr, 10) : 3000;
    }
    set reconnectInterval(value) {
        this.setAttribute("reconnect-interval", String(value));
    }
    get maxReconnects() {
        const attr = this.getAttribute("max-reconnects");
        return attr ? parseInt(attr, 10) : Infinity;
    }
    set maxReconnects(value) {
        this.setAttribute("max-reconnects", String(value));
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
    get message() {
        return this._core.message;
    }
    get connected() {
        return this._core.connected;
    }
    get loading() {
        return this._core.loading;
    }
    get error() {
        return this._core.error;
    }
    get readyState() {
        return this._core.readyState;
    }
    // --- Command properties ---
    get trigger() {
        return this._trigger;
    }
    set trigger(value) {
        const v = !!value;
        if (v) {
            this._trigger = true;
            this.connect();
            this._trigger = false;
            this.dispatchEvent(new CustomEvent("wcs-ws:trigger-changed", {
                detail: false,
                bubbles: true,
            }));
        }
    }
    set send(data) {
        if (data === null || data === undefined)
            return;
        const payload = typeof data === "string" ? data : JSON.stringify(data);
        this._core.send(payload);
        this.dispatchEvent(new CustomEvent("wcs-ws:send-changed", {
            detail: null,
            bubbles: true,
        }));
    }
    // --- Public methods ---
    connect() {
        const protocols = this.protocols
            ? this.protocols.split(",").map(p => p.trim()).filter(Boolean)
            : undefined;
        this._core.connect(this.url, {
            protocols: protocols && protocols.length === 1 ? protocols[0] : protocols,
            autoReconnect: this.autoReconnect,
            reconnectInterval: this.reconnectInterval,
            maxReconnects: this.maxReconnects,
        });
    }
    sendMessage(data) {
        this._core.send(data);
    }
    close(code, reason) {
        this._core.close(code, reason);
    }
    // --- Lifecycle ---
    attributeChangedCallback(name, _oldValue, newValue) {
        if (name === "url" && this.isConnected && !this.manual && newValue) {
            this.connect();
        }
    }
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        if (!this.manual && this.url) {
            this.connect();
        }
    }
    disconnectedCallback() {
        this._core.close();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.ws)) {
        customElements.define(config.tagNames.ws, WcsWebSocket);
    }
}

function bootstrapWebSocket(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { WcsWebSocket, WebSocketCore, bootstrapWebSocket, getConfig };
//# sourceMappingURL=index.esm.js.map

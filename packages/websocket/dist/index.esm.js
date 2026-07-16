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

/**
 * websocketCapabilities.ts
 *
 * WebSocket node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。WebSocket は持続的な session / monitor node(1 本の接続を張り続ける)で、
 * 競合する operation を持たないため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 *
 * この node の `_setError` は 4 形態の非 null 入力を受ける(いずれも公開 `error` shape は不変):
 *   1. synthetic な `{ message: "url is required." }`(`.name` 無し)— connect() の引数不備。
 *   2. synthetic な `{ message: "WebSocket is not connected." }`(`.name` 無し)— open 前の send()。
 *   3. caught された生の構築例外 `e`(`new WebSocket()` の同期 throw)。
 *   4. platform の WebSocket `error` Event(`Event`。`.name`/`.message` を持たない)。
 *
 * これらは shape がバラバラで、message からの分類は脆い。そこで呼び出し側が明示的な
 * taxonomy code を discriminator として渡す(storage の `deriveStorageErrorInfo(error, name)`
 * と同じ技法)。derive 側は synthetic / Event / Error を reverse-engineer せず、渡された
 * code で phase / recoverable を決め、message だけを防御的に抽出する。
 */
/** 安定した websocket error code(taxonomy)。値は公開キーとして固定。 */
const WCS_WEBSOCKET_ERROR_CODE = {
    /** connect() の `url` 未指定 — 開始前の入力不備。retry では回復しない。 */
    InvalidArgument: "invalid-argument",
    /** open 前の send() — 接続が OPEN でない状態での送信。retry では回復しない(先に connect が要る)。 */
    InvalidState: "invalid-state",
    /**
     * 接続の確立 / 維持に失敗(`new WebSocket()` の同期例外、または platform の error Event)。
     * WebSocket のエラーは通常一過性で、再接続で回復しうる(recoverable=true)。
     */
    ConnectionError: "connection-error",
};
/**
 * websocket の失敗を serializable な error taxonomy に写す。`code` は呼び出し側が渡す
 * discriminator(公開 `error` shape からは復元しない)。`message` は入力から防御的に抽出し、
 * message を持たない error Event 等では安定した fallback を使う。
 *
 * - `invalid-argument`(url 未指定)は開始前の入力不備 → phase="start" / recoverable=false。
 * - `invalid-state`(open 前 send)は接続状態が満たされない実行時失敗 → phase="execute" /
 *   recoverable=false(先に connect() が必要)。
 * - `connection-error`(構築例外 / error Event)は接続の確立 / 維持失敗 → phase="execute" /
 *   recoverable=true(再接続で回復しうる)。
 */
function deriveWebSocketErrorInfo(error, code) {
    // error は非 null(_setError は error===null を derive 前に分岐する)だが、synthetic /
    // Event / caught 例外 / 生 throw と shape がバラバラなので message は防御的に抽出する。
    // error Event は message を持たないため安定した fallback に落とす。
    const raw = error.message;
    const message = typeof raw === "string" ? raw : "WebSocket connection error";
    if (code === WCS_WEBSOCKET_ERROR_CODE.InvalidArgument) {
        return { code: WCS_WEBSOCKET_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
    }
    if (code === WCS_WEBSOCKET_ERROR_CODE.InvalidState) {
        return { code: WCS_WEBSOCKET_ERROR_CODE.InvalidState, phase: "execute", recoverable: false, message };
    }
    // connection-error(構築例外 / error Event): 接続の確立/維持失敗、再接続で回復しうる。
    return { code: WCS_WEBSOCKET_ERROR_CODE.ConnectionError, phase: "execute", recoverable: true, message };
}

// WebSocket readyState values. Hardcoded rather than read from the global
// WebSocket so the Core does not require WebSocket to exist at module load
// (referencing `WebSocket.CLOSED` in a field initializer evaluates at class
// definition time; tests inject a mock). Mirrors SseCore's SSE_CLOSED.
const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSED = 3;
class WebSocketCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "message", event: "wcs-ws:message" },
            { name: "connected", event: "wcs-ws:connected-changed" },
            { name: "loading", event: "wcs-ws:loading-changed" },
            { name: "error", event: "wcs-ws:error" },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output derived from `error` (invalid-argument / invalid-state
            // / connection-error); the existing `error` property/event are unchanged. Fires
            // wcs-ws:error-info-changed. No lane — WebSocket is a persistent session/monitor
            // node, not a competing operation.
            { name: "errorInfo", event: "wcs-ws:error-info-changed" },
            { name: "readyState", event: "wcs-ws:readystate-changed" },
        ],
        commands: [
            { name: "connect" },
            { name: "send" },
            { name: "close" },
        ],
    };
    _target;
    _ws = null;
    _message = null;
    _connected = false;
    _loading = false;
    _error = null;
    _errorInfo = null;
    _readyState = WS_CLOSED;
    // 自動再接続
    _autoReconnect = false;
    _reconnectInterval = 3000;
    _maxReconnects = Infinity;
    _reconnectCount = 0;
    _reconnectTimer = null;
    _url = "";
    _protocols = undefined;
    _binaryType = "blob";
    _intentionalClose = false;
    // Generation guard (§3.4): bumped on dispose() and at every connect(). A socket
    // event (open/message/error/close) or a scheduled reconnect that fires after
    // dispose / a superseding connect() carries a stale `gen` and MUST NOT write
    // state onto a torn-down element. A boolean flag is insufficient (dispose→observe
    // would let stale work slip through).
    _gen = 0;
    // Generation captured when the current socket was opened. The shared socket
    // event handlers compare it against _gen to drop events from a superseded /
    // disposed connection.
    _socketGen = 0;
    // SSR (§3.8): WebSocket is command-driven with no asynchronous probe to await,
    // so readiness is immediate.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get ready() {
        return this._ready;
    }
    // Lifecycle (§3.5). WebSocket connections are command-driven (connect()), so
    // observe() is an idempotent no-op that resolves once ready; the Shell's
    // connectedCallback does not auto-establish a subscription here. dispose()
    // invalidates any in-flight socket / pending reconnect and closes the socket.
    observe() {
        return this._ready;
    }
    dispose() {
        this._gen++;
        this.close();
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
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-ws:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
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
    // `code` is an explicit taxonomy discriminator (WCS_WEBSOCKET_ERROR_CODE), passed
    // only from the non-null failure call sites. It stays out of the public `error`
    // shape and is used solely to classify errorInfo without reverse-engineering the
    // heterogeneous `error` values (synthetic {message} / caught Error / raw Event).
    // The clear path passes null and no code.
    _setError(error, code) {
        // Same-value guard (async-io-node-guidelines.md §3.3). `error` is state-ish,
        // so suppressing redundant null→null dispatches (every connect/send start
        // clears a usually-already-null error) avoids a spurious wcs-ws:error per
        // successful operation. Reference identity is sufficient: each failure builds
        // a fresh object (or the platform's own error Event), and the clear path
        // always passes null.
        if (this._error === error)
            return;
        this._error = error;
        // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the
        // explicit `code` (or null on clear). Fires before the `error` event so an
        // observer binding both sees the classification first, mirroring the io-node
        // family. Every non-null error carries a code (the clear path is the only
        // caller without one, and it is short-circuited here), so `code!` holds.
        this._commitErrorInfo(error === null ? null : deriveWebSocketErrorInfo(error, code));
        this._target.dispatchEvent(new CustomEvent("wcs-ws:error", {
            detail: error,
            bubbles: true,
        }));
    }
    // Called only from _setError (which already same-value-guards on the error
    // reference), so errorInfo transitions exactly when error does — no separate
    // guard needed here.
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-ws:error-info-changed", {
            detail: info,
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
        // never-throw (§3.6): 引数バリデーション失敗は例外ではなく error プロパティに
        // 流し、サニタイズ値(なにもしない)を返す。command-token 経路（set trigger →
        // connect()）からの呼び出しが state 更新サイクルを壊さないようにする。
        if (!url) {
            this._setError({ message: "url is required." }, WCS_WEBSOCKET_ERROR_CODE.InvalidArgument);
            return;
        }
        // 新しい接続を開始するため世代を更新し、進行中のソケット/再接続を無効化する。
        this._gen++;
        // 既存の接続をクローズ
        this._intentionalClose = true;
        this._closeInternal();
        this._url = url;
        this._protocols = options.protocols;
        this._autoReconnect = options.autoReconnect ?? false;
        this._reconnectInterval = options.reconnectInterval ?? 3000;
        this._maxReconnects = options.maxReconnects ?? Infinity;
        this._binaryType = options.binaryType ?? "blob";
        this._reconnectCount = 0;
        this._intentionalClose = false;
        this._doConnect();
    }
    send(data) {
        // never-throw (§3.6): 未接続での送信は例外ではなく error に流す。set send の
        // fire-and-forget 経路で例外が伝播するのを防ぐ。
        if (!this._ws || this._ws.readyState !== WS_OPEN) {
            this._setError({ message: "WebSocket is not connected." }, WCS_WEBSOCKET_ERROR_CODE.InvalidState);
            return;
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
        // 接続開始時点の世代を捕捉。dispose()/再 connect() 後に発火した古いソケット
        // イベントはこの gen が stale になり、状態を書き換えない（_onOpen ほかが
        // _socketGen と this._gen を突き合わせて判定する）。
        this._socketGen = this._gen;
        try {
            this._ws = this._protocols
                ? new WebSocket(this._url, this._protocols)
                : new WebSocket(this._url);
        }
        catch (e) {
            this._setLoading(false);
            this._setError(e, WCS_WEBSOCKET_ERROR_CODE.ConnectionError);
            return;
        }
        // Binary frames default to Blob; opt into ArrayBuffer for direct byte access.
        this._ws.binaryType = this._binaryType;
        this._setReadyState(WS_CONNECTING);
        this._ws.addEventListener("open", this._onOpen);
        this._ws.addEventListener("message", this._onMessage);
        this._ws.addEventListener("error", this._onError);
        this._ws.addEventListener("close", this._onClose);
    }
    _onOpen = () => {
        if (this._socketGen !== this._gen)
            return;
        this._reconnectCount = 0;
        this._setLoading(false);
        this._setConnected(true);
        this._setReadyState(WS_OPEN);
    };
    _onMessage = (event) => {
        if (this._socketGen !== this._gen)
            return;
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
        if (this._socketGen !== this._gen)
            return;
        this._setError(event, WCS_WEBSOCKET_ERROR_CODE.ConnectionError);
    };
    _onClose = (event) => {
        this._removeListeners();
        this._ws = null;
        if (this._socketGen !== this._gen)
            return;
        this._setConnected(false);
        this._setLoading(false);
        this._setReadyState(WS_CLOSED);
        // 異常クローズ時の自動再接続（正常終了 1000 は除外）
        if (!this._intentionalClose && this._autoReconnect && event.code !== 1000 && this._reconnectCount < this._maxReconnects) {
            this._scheduleReconnect();
        }
    };
    _scheduleReconnect() {
        const gen = this._gen;
        this._clearReconnectTimer();
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            // dispose()/再 connect() でこの再接続が無効化されていたら何もしない。
            if (gen !== this._gen)
                return;
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
        if (!this._ws) {
            return;
        }
        this._ws.removeEventListener("open", this._onOpen);
        this._ws.removeEventListener("message", this._onMessage);
        this._ws.removeEventListener("error", this._onError);
        this._ws.removeEventListener("close", this._onClose);
    }
    _closeInternal() {
        this._clearReconnectTimer();
        if (this._ws) {
            this._removeListeners();
            if (this._ws.readyState === WS_OPEN || this._ws.readyState === WS_CONNECTING) {
                this._ws.close();
            }
            this._ws = null;
        }
        // 旧接続の状態をリセット（コンストラクタ例外時に stale 状態が残るのを防止）
        if (this._connected) {
            this._setConnected(false);
        }
        if (this._readyState !== WS_CLOSED) {
            this._setReadyState(WS_CLOSED);
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
    // Resolve the registered constructor at call time instead of importing
    // WcsWebSocket as a value. The value import created a components/WebSocket.ts ⇄
    // autoTrigger.ts cycle (WcsWebSocket.connectedCallback() calls
    // registerAutoTrigger()). instanceof against the customElements registry keeps
    // the exact same identity guarantee — only the registered <wcs-ws> class
    // matches — without the import cycle.
    const WsCtor = customElements.get(config.tagNames.ws);
    const wsElement = document.getElementById(wsId);
    if (!WsCtor || !(wsElement instanceof WsCtor))
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
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...WebSocketCore.wcBindable,
        properties: [
            ...WebSocketCore.wcBindable.properties,
            { name: "trigger", event: "wcs-ws:trigger-changed" },
            { name: "send", event: "wcs-ws:send-changed" },
        ],
        inputs: [
            { name: "url", attribute: "url" },
            { name: "protocols", attribute: "protocols" },
            { name: "autoReconnect", attribute: "auto-reconnect" },
            { name: "reconnectInterval", attribute: "reconnect-interval" },
            { name: "maxReconnects", attribute: "max-reconnects" },
            { name: "binaryType", attribute: "binary-type" },
            { name: "manual", attribute: "manual" },
            { name: "trigger" },
            { name: "send" },
        ],
        commands: [
            { name: "connect" },
            { name: "sendMessage" },
            { name: "close" },
        ],
    };
    static get observedAttributes() { return ["url"]; }
    _core;
    _trigger = false;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new WebSocketCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-ws:connected-changed": (d) => ({ connected: d === true }),
            "wcs-ws:loading-changed": (d) => ({ loading: d === true }),
            "wcs-ws:error": (d) => ({ error: d != null }),
        });
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
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
        const parsed = attr ? parseInt(attr, 10) : 3000;
        return Number.isNaN(parsed) ? 3000 : parsed;
    }
    set reconnectInterval(value) {
        this.setAttribute("reconnect-interval", String(value));
    }
    get maxReconnects() {
        const attr = this.getAttribute("max-reconnects");
        const parsed = attr ? parseInt(attr, 10) : Infinity;
        return Number.isNaN(parsed) ? Infinity : parsed;
    }
    set maxReconnects(value) {
        this.setAttribute("max-reconnects", String(value));
    }
    // Incoming binary frame representation. Backed by the `binary-type` attribute;
    // any value other than "arraybuffer" normalizes to the platform default "blob".
    get binaryType() {
        return this.getAttribute("binary-type") === "arraybuffer" ? "arraybuffer" : "blob";
    }
    set binaryType(value) {
        if (value == null) {
            this.removeAttribute("binary-type");
        }
        else {
            this.setAttribute("binary-type", value);
        }
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
    get errorInfo() {
        return this._core.errorInfo;
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
    // `send` is a write-only command surface: assigning transmits immediately.
    // Reading always returns null (no payload is retained) — consistent with the
    // null carried by wcs-ws:send-changed and the documented "resets to null".
    get send() {
        return null;
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
            binaryType: this.binaryType,
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
        // observe() は command-driven node では ready を返す no-op（§3.5）。SSR は
        // connectedCallbackPromise を await して初期スナップショットを取れる。
        this._connectedCallbackPromise = this._core.observe();
        if (!this.manual && this.url) {
            this.connect();
        }
    }
    disconnectedCallback() {
        // dispose() が _gen を bump して進行中のソケット/再接続を無効化し、close() する。
        this._core.dispose();
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

export { WCS_WEBSOCKET_ERROR_CODE, WcsWebSocket, WebSocketCore, bootstrapWebSocket, getConfig };
//# sourceMappingURL=index.esm.js.map

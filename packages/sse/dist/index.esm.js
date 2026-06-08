const _config = {
    tagNames: {
        sse: "wcs-sse",
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
// `config` は内部可変オブジェクト `_config` のエイリアス（IConfig は readonly 型だが
// 実体は setConfig で書き換わる可変ミラー）。これはモジュール内部での参照用であり、
// 外部に公開する不変ビューは getConfig() が返す凍結コピーのみ。直接 mutate しないこと。
const config = _config;
function getConfig() {
    if (!frozenConfig) {
        frozenConfig = deepFreeze(deepClone(_config));
    }
    return frozenConfig;
}
function setConfig(partialConfig) {
    if (partialConfig.tagNames) {
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    frozenConfig = null;
}

function raiseError(message) {
    throw new Error(`[@wcstack/sse] ${message}`);
}

// EventSource readyState values. Hardcoded rather than read from the global
// EventSource so the Core does not require EventSource to exist at module load
// (happy-dom omits it; tests inject a mock).
const SSE_OPEN = 1;
const SSE_CLOSED = 2;
class SseCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "message", event: "wcs-sse:message" },
            { name: "connected", event: "wcs-sse:connected-changed" },
            { name: "loading", event: "wcs-sse:loading-changed" },
            { name: "error", event: "wcs-sse:error" },
            { name: "readyState", event: "wcs-sse:readystate-changed" },
        ],
        commands: [
            { name: "connect" },
            { name: "close" },
        ],
    };
    _target;
    _es = null;
    _message = null;
    _connected = false;
    _loading = false;
    _error = null;
    _readyState = SSE_CLOSED;
    _url = "";
    _withCredentials = false;
    _events = [];
    _raw = false;
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
        this._target.dispatchEvent(new CustomEvent("wcs-sse:message", {
            detail: message,
            bubbles: true,
        }));
    }
    // connected/loading/error/readyState are idempotent *status* (not events), so
    // they carry a same-value guard: native reconnection re-fires `error` while the
    // stream sits in CONNECTING, and without the guard each retry would re-emit an
    // unchanged connected=false / loading=true / readyState=CONNECTING. `message`
    // is deliberately NOT guarded (a received event is a distinct occurrence each
    // time). `error` uses reference identity — every real failure is a fresh Event,
    // so it still re-fires; only redundant null→null clears are suppressed.
    _setConnected(connected) {
        if (this._connected === connected)
            return;
        this._connected = connected;
        this._target.dispatchEvent(new CustomEvent("wcs-sse:connected-changed", {
            detail: connected,
            bubbles: true,
        }));
    }
    _setLoading(loading) {
        if (this._loading === loading)
            return;
        this._loading = loading;
        this._target.dispatchEvent(new CustomEvent("wcs-sse:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    _setError(error) {
        if (this._error === error)
            return;
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-sse:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _setReadyState(readyState) {
        if (this._readyState === readyState)
            return;
        this._readyState = readyState;
        this._target.dispatchEvent(new CustomEvent("wcs-sse:readystate-changed", {
            detail: readyState,
            bubbles: true,
        }));
    }
    // --- Public API ---
    /**
     * Open an SSE connection. Required `url`; `options` are evaluated once at the
     * time the EventSource is created.
     *
     * Idempotency / headless note: if already connected (CONNECTING/OPEN) to the
     * *same* url, a re-`connect()` is a no-op — including when `options`
     * (events/raw/withCredentials) differ. The guard keys on url only (see the
     * inline comment below), so to apply new options to a live stream a headless
     * caller must `close()` first, then `connect()` with the new options. After a
     * permanent failure (readyState CLOSED) the guard is bypassed and `connect()`
     * reconnects with the supplied options.
     */
    connect(url, options = {}) {
        if (!url) {
            raiseError("url is required.");
        }
        // 同一 url で接続中(CONNECTING/OPEN)なら no-op。同じストリームへの再接続は churn
        // でしかなく（EventSource は再接続をネイティブに行う）、custom element の *upgrade*
        // 経路を吸収する：autoloader がマークアップ存在後にタグを定義すると、仕様により
        // 接続済み要素で attributeChangedCallback(isConnected===true) と connectedCallback
        // が両方発火し Shell が connect() を2回呼ぶ。このガードが無いと接続を1本開いて即破棄
        // する。CLOSED（恒久エラー後）は guard を外れて再接続できる。
        // ※ events/raw/withCredentials は observedAttributes 外で宣言的には変更できないため
        //   url 一致のみで判定する（broadcast の open() が name 一致で冪等化するのと同型）。
        if (this._es && this._url === url && this._readyState !== SSE_CLOSED) {
            return;
        }
        // 既存の接続をクローズ
        this._closeInternal();
        this._url = url;
        this._withCredentials = options.withCredentials ?? false;
        this._events = options.events ?? [];
        this._raw = options.raw ?? false;
        this._doConnect();
    }
    close() {
        this._closeInternal();
    }
    // --- Internal ---
    _doConnect() {
        // 状態通知（_setLoading/_setError）は同期 dispatch するため、リスナが再入的に
        // connect(別url)/close() を呼ぶと this._es を差し替え得る。_onError と同じ所有権
        // ガードを敷くため、(1) EventSource 生成・リスナ登録を *先に* 済ませて this._es を
        // 確定させ、(2) 確定後に状態通知を出す、という順序にする。通知 dispatch で再入が
        // 起きても、その時点で外側は自分の es を確定済みなので「dispatch 後に this._es を
        // 上書きする」逸脱が起きない。
        let es;
        try {
            es = this._withCredentials
                ? new EventSource(this._url, { withCredentials: true })
                : new EventSource(this._url);
        }
        catch (e) {
            // 生成失敗：dispatch はまだしていないので this._es 上書き競合は無い。
            this._es = null;
            this._setLoading(false);
            this._setError(e);
            return;
        }
        this._es = es;
        // この時点の events を捕捉（再入で this._events が差し替わってもこの es の解除に使う）。
        const events = this._events;
        es.addEventListener("open", this._onOpen);
        es.addEventListener("message", this._onMessage);
        es.addEventListener("error", this._onError);
        // 名前付きイベント（`event:` フィールド）を購読し、すべて message に集約する。
        // SSE 仕様上、名前付きイベントも message と同じく MessageEvent として配送される
        // （data/lastEventId を持つ）ため _onMessage(event: MessageEvent) で受けて問題ない。
        // addEventListener のシグネチャ上 EventListener へのキャストが要るだけで実害はない。
        for (const name of events) {
            es.addEventListener(name, this._onMessage);
        }
        // ここから状態通知。各 dispatch のリスナが再入して this._es を差し替えたら、以降の
        // 通知を放棄し、自分が生成した es をリスナごと破棄する（リーク防止＋再入側の状態を
        // 上書きしない。_onError の `if (this._es !== es) return;` と同型の所有権ガード）。
        this._setLoading(true);
        if (this._es !== es) {
            this._removeListeners(es, events);
            es.close();
            return;
        }
        this._setError(null);
        if (this._es !== es) {
            this._removeListeners(es, events);
            es.close();
            return;
        }
        this._setReadyState(es.readyState);
    }
    _onOpen = () => {
        this._setLoading(false);
        this._setConnected(true);
        this._setReadyState(SSE_OPEN);
        // 接続確立時に error をクリアする。ネイティブ再接続（トランジェントエラー後）は
        // _doConnect を経由せず open が直接発火するため、ここでクリアしないと
        // connected=true のまま古い error Event が残り state に不整合が露出する。
        // same-value ガードにより、error が元々 null なら冗長な dispatch は起きない。
        this._setError(null);
    };
    _onMessage = (event) => {
        let data = event.data;
        // JSONの自動パース（raw 指定時はテキストのまま）
        if (!this._raw && typeof data === "string") {
            try {
                data = JSON.parse(data);
            }
            catch {
                // テキストのまま
            }
        }
        this._setMessage({
            event: event.type,
            data,
            // WcsSseMessage.lastEventId は非 null string 契約。実 MessageEvent では常に
            // string（無指定時は ""）だが、named-event 購読の `as EventListener` キャストで
            // 型保証を握り潰しているため、念のため ?? "" でフォールバックし契約を守る。
            lastEventId: event.lastEventId ?? "",
        });
    };
    _onError = (event) => {
        // 発火元の EventSource をローカル退避してから dispatch する。_setError は
        // wcs-sse:error を同期 dispatch するため、リスナが再入的に close()/connect() を
        // 呼ぶと _closeInternal が this._es を null（または新インスタンス）に差し替え得る。
        // 退避しないと dispatch 後の readyState 参照が null 参照でクラッシュし、再入が
        // 確定させた状態を後続の setter が上書き・巻き戻す不整合も生む。
        const es = this._es;
        const state = es.readyState;
        this._setError(event);
        // 再入した close()/connect() で自分が無効化されたら、以降の状態更新は放棄する
        // （再入側が確定させた状態が正。broadcast の _onMessage が dispatch 後に
        // ライフサイクル参照を deref しないのと同等の堅牢性に揃える）。
        if (this._es !== es)
            return;
        // EventSource は CloseEvent を持たず、error が切断も兼ねる。
        // readyState で「再接続中(CONNECTING)」と「死亡(CLOSED)」を判別する。
        this._setReadyState(state);
        this._setConnected(false);
        // CLOSED ＝ ネイティブ再接続は行われない（恒久エラー）。
        // それ以外（CONNECTING）＝ ブラウザが自動再接続中なので loading を維持。
        this._setLoading(state !== SSE_CLOSED);
        // 恒久エラー時は死んだ EventSource をリスナごと即時破棄する。次の connect()/close()
        // まで放置すると死んだインスタンスとリスナを保持し続けるため。状態は上で CLOSED に
        // 揃え済みなので _closeInternal は使わず（再 dispatch 不要）、参照だけ解放する。
        if (state === SSE_CLOSED) {
            // ここでは所有権ガードを通過済みのため this._es === es。
            this._removeListeners(es, this._events);
            this._es = null;
        }
    };
    // 特定の EventSource とその登録時の events からリスナを解除する。再入で this._es や
    // this._events が差し替わった後でも、捕捉済みの es/events を渡せば正しく解除できる。
    // 呼び出し側が常に非 null の es を渡す（_closeInternal は `if (this._es)` 内、
    // _doConnect は生成直後の es を渡す）ため null ガードは置かない。
    _removeListeners(es, events) {
        es.removeEventListener("open", this._onOpen);
        es.removeEventListener("message", this._onMessage);
        es.removeEventListener("error", this._onError);
        for (const name of events) {
            es.removeEventListener(name, this._onMessage);
        }
    }
    _closeInternal() {
        if (this._es) {
            this._removeListeners(this._es, this._events);
            this._es.close();
            this._es = null;
        }
        // EventSource.close() はイベントを発火しないため状態を手動でリセット。
        // 各 setter が same-value ガードを持つので、冗長な dispatch は起きない。
        this._setConnected(false);
        this._setLoading(false);
        this._setReadyState(SSE_CLOSED);
    }
}

class WcsSse extends HTMLElement {
    // wc-bindable アダプタが読む外部契約フラグ。EventSource 接続は connectedCallback で
    // 同期的に開く（非同期初期化が無い）ため connectedCallbackPromise は不要 ＝ false。
    // <wcs-ws> / <wcs-broadcast> と揃える。
    static hasConnectedCallbackPromise = false;
    static wcBindable = {
        ...SseCore.wcBindable,
        properties: [
            ...SseCore.wcBindable.properties,
            { name: "trigger", event: "wcs-sse:trigger-changed" },
        ],
        inputs: [
            { name: "url", attribute: "url" },
            { name: "withCredentials", attribute: "with-credentials" },
            { name: "events", attribute: "events" },
            { name: "raw", attribute: "raw" },
            { name: "manual", attribute: "manual" },
            { name: "trigger" },
        ],
        // Core の commands をそのまま継承（単一情報源）。<wcs-broadcast>/<wcs-worker> と
        // 同型。spread でも継承されるが、Core に command 追加時の追従漏れを防ぐため明示参照する。
        commands: SseCore.wcBindable.commands,
    };
    // 接続を張り直す価値があるのは url 変更のみ。with-credentials/events/raw/manual は
    // 「初回接続時に評価される接続オプション」であり、observedAttributes に含めない＝
    // 後から属性を変えても既存接続には反映されない（再接続したい場合は close()→connect()）。
    static get observedAttributes() { return ["url"]; }
    _core;
    _trigger = false;
    constructor() {
        super();
        this._core = new SseCore(this);
    }
    // --- Attribute accessors ---
    get url() {
        return this.getAttribute("url") || "";
    }
    set url(value) {
        this.setAttribute("url", value);
    }
    get withCredentials() {
        return this.hasAttribute("with-credentials");
    }
    set withCredentials(value) {
        if (value) {
            this.setAttribute("with-credentials", "");
        }
        else {
            this.removeAttribute("with-credentials");
        }
    }
    // Shell の events は CSV 文字列（DOM 属性そのまま）。connect() で split して
    // SseCore.connect の string[] options.events に変換する（Core 側は配列）。
    get events() {
        return this.getAttribute("events") || "";
    }
    set events(value) {
        this.setAttribute("events", value);
    }
    get raw() {
        return this.hasAttribute("raw");
    }
    set raw(value) {
        if (value) {
            this.setAttribute("raw", "");
        }
        else {
            this.removeAttribute("raw");
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
            // try/finally で connect() が将来例外を投げても _trigger 固着を防ぎ、
            // auto-reset と完了通知（wcs-sse:trigger-changed）を必ず実行する。
            try {
                this.connect();
            }
            finally {
                this._trigger = false;
                this.dispatchEvent(new CustomEvent("wcs-sse:trigger-changed", {
                    detail: false,
                    bubbles: true,
                }));
            }
        }
    }
    // --- Public methods ---
    connect() {
        // Shell は宣言的サーフェス：url 未設定での connect()/trigger は静かに no-op する
        // （SseCore.connect("") は programmatic 誤用向けに throw するが、state 配線で trigger
        // が url より先に立っただけで例外が更新サイクルを壊すのは避ける。broadcast の
        // Broadcast.open() が `if (this.name)` でガードするのと同型）。
        if (!this.url) {
            return;
        }
        const events = this.events
            ? this.events.split(",").map(e => e.trim()).filter(Boolean)
            : undefined;
        this._core.connect(this.url, {
            withCredentials: this.withCredentials,
            events,
            raw: this.raw,
        });
    }
    close() {
        this._core.close();
    }
    // --- Lifecycle ---
    attributeChangedCallback(name, _oldValue, newValue) {
        // newValue が falsy（url を空文字に変更／属性除去）の場合は何もしない＝既存接続を
        // そのまま生かす。これは意図的で broadcast の name 変更と同型：宣言的サーフェスは
        // 「意味のある新 url」に対してのみ張り替え、falsy への変化を切断トリガーとはしない
        // （切断は close() か DOM からの除去で明示的に行う）。
        if (name === "url" && this.isConnected && !this.manual && newValue) {
            this.connect();
        }
    }
    connectedCallback() {
        this.style.display = "none";
        if (!this.manual && this.url) {
            this.connect();
        }
    }
    disconnectedCallback() {
        this._core.close();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.sse)) {
        customElements.define(config.tagNames.sse, WcsSse);
    }
}

function bootstrapSse(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { SseCore, WcsSse, bootstrapSse, getConfig };
//# sourceMappingURL=index.esm.js.map

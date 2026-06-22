import { IWcBindable } from "../types.js";

// WebSocket readyState values. Hardcoded rather than read from the global
// WebSocket so the Core does not require WebSocket to exist at module load
// (referencing `WebSocket.CLOSED` in a field initializer evaluates at class
// definition time; tests inject a mock). Mirrors SseCore's SSE_CLOSED.
const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSED = 3;

export interface WebSocketConnectOptions {
  protocols?: string | string[];
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnects?: number;
}

export class WebSocketCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "message", event: "wcs-ws:message" },
      { name: "connected", event: "wcs-ws:connected-changed" },
      { name: "loading", event: "wcs-ws:loading-changed" },
      { name: "error", event: "wcs-ws:error" },
      { name: "readyState", event: "wcs-ws:readystate-changed" },
    ],
    commands: [
      { name: "connect" },
      { name: "send" },
      { name: "close" },
    ],
  };

  private _target: EventTarget;
  private _ws: WebSocket | null = null;
  private _message: any = null;
  private _connected: boolean = false;
  private _loading: boolean = false;
  private _error: any = null;
  private _readyState: number = WS_CLOSED;

  // 自動再接続
  private _autoReconnect: boolean = false;
  private _reconnectInterval: number = 3000;
  private _maxReconnects: number = Infinity;
  private _reconnectCount: number = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _url: string = "";
  private _protocols: string | string[] | undefined = undefined;
  private _intentionalClose: boolean = false;

  // Generation guard (§3.4): bumped on dispose() and at every connect(). A socket
  // event (open/message/error/close) or a scheduled reconnect that fires after
  // dispose / a superseding connect() carries a stale `gen` and MUST NOT write
  // state onto a torn-down element. A boolean flag is insufficient (dispose→observe
  // would let stale work slip through).
  private _gen = 0;
  // Generation captured when the current socket was opened. The shared socket
  // event handlers compare it against _gen to drop events from a superseded /
  // disposed connection.
  private _socketGen = 0;
  // SSR (§3.8): WebSocket is command-driven with no asynchronous probe to await,
  // so readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  // Lifecycle (§3.5). WebSocket connections are command-driven (connect()), so
  // observe() is an idempotent no-op that resolves once ready; the Shell's
  // connectedCallback does not auto-establish a subscription here. dispose()
  // invalidates any in-flight socket / pending reconnect and closes the socket.
  observe(): Promise<void> {
    return this._ready;
  }

  dispose(): void {
    this._gen++;
    this.close();
  }

  get message(): any {
    return this._message;
  }

  get connected(): boolean {
    return this._connected;
  }

  get loading(): boolean {
    return this._loading;
  }

  get error(): any {
    return this._error;
  }

  get readyState(): number {
    return this._readyState;
  }

  // --- State setters with event dispatch ---

  private _setMessage(message: any): void {
    this._message = message;
    this._target.dispatchEvent(new CustomEvent("wcs-ws:message", {
      detail: message,
      bubbles: true,
    }));
  }

  private _setConnected(connected: boolean): void {
    this._connected = connected;
    this._target.dispatchEvent(new CustomEvent("wcs-ws:connected-changed", {
      detail: connected,
      bubbles: true,
    }));
  }

  private _setLoading(loading: boolean): void {
    this._loading = loading;
    this._target.dispatchEvent(new CustomEvent("wcs-ws:loading-changed", {
      detail: loading,
      bubbles: true,
    }));
  }

  private _setError(error: any): void {
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-ws:error", {
      detail: error,
      bubbles: true,
    }));
  }

  private _setReadyState(readyState: number): void {
    this._readyState = readyState;
    this._target.dispatchEvent(new CustomEvent("wcs-ws:readystate-changed", {
      detail: readyState,
      bubbles: true,
    }));
  }

  // --- Public API ---

  connect(url: string, options: WebSocketConnectOptions = {}): void {
    // never-throw (§3.6): 引数バリデーション失敗は例外ではなく error プロパティに
    // 流し、サニタイズ値(なにもしない)を返す。command-token 経路（set trigger →
    // connect()）からの呼び出しが state 更新サイクルを壊さないようにする。
    if (!url) {
      this._setError({ message: "url is required." });
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
    this._reconnectCount = 0;
    this._intentionalClose = false;

    this._doConnect();
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    // never-throw (§3.6): 未接続での送信は例外ではなく error に流す。set send の
    // fire-and-forget 経路で例外が伝播するのを防ぐ。
    if (!this._ws || this._ws.readyState !== WS_OPEN) {
      this._setError({ message: "WebSocket is not connected." });
      return;
    }
    this._ws.send(data);
  }

  close(code?: number, reason?: string): void {
    this._intentionalClose = true;
    this._clearReconnectTimer();
    if (this._ws) {
      this._ws.close(code, reason);
    }
  }

  // --- Internal ---

  private _doConnect(): void {
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
    } catch (e) {
      this._setLoading(false);
      this._setError(e);
      return;
    }

    this._setReadyState(WS_CONNECTING);

    this._ws.addEventListener("open", this._onOpen);
    this._ws.addEventListener("message", this._onMessage);
    this._ws.addEventListener("error", this._onError);
    this._ws.addEventListener("close", this._onClose);
  }

  private _onOpen = (): void => {
    if (this._socketGen !== this._gen) return;
    this._reconnectCount = 0;
    this._setLoading(false);
    this._setConnected(true);
    this._setReadyState(WS_OPEN);
  };

  private _onMessage = (event: MessageEvent): void => {
    if (this._socketGen !== this._gen) return;
    let data = event.data;
    // JSONの自動パース
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        // テキストのまま
      }
    }
    this._setMessage(data);
  };

  private _onError = (event: Event): void => {
    if (this._socketGen !== this._gen) return;
    this._setError(event);
  };

  private _onClose = (event: CloseEvent): void => {
    this._removeListeners();
    this._ws = null;
    if (this._socketGen !== this._gen) return;
    this._setConnected(false);
    this._setLoading(false);
    this._setReadyState(WS_CLOSED);

    // 異常クローズ時の自動再接続（正常終了 1000 は除外）
    if (!this._intentionalClose && this._autoReconnect && event.code !== 1000 && this._reconnectCount < this._maxReconnects) {
      this._scheduleReconnect();
    }
  };

  private _scheduleReconnect(): void {
    const gen = this._gen;
    this._clearReconnectTimer();
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      // dispose()/再 connect() でこの再接続が無効化されていたら何もしない。
      if (gen !== this._gen) return;
      this._reconnectCount++;
      this._doConnect();
    }, this._reconnectInterval);
  }

  private _clearReconnectTimer(): void {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _removeListeners(): void {
    if (!this._ws) {
      return;
    }

    this._ws.removeEventListener("open", this._onOpen);
    this._ws.removeEventListener("message", this._onMessage);
    this._ws.removeEventListener("error", this._onError);
    this._ws.removeEventListener("close", this._onClose);
  }

  private _closeInternal(): void {
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

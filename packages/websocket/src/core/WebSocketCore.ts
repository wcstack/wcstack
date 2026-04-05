import { raiseError } from "../raiseError.js";
import { IWcBindable } from "../types.js";

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
  };

  private _target: EventTarget;
  private _ws: WebSocket | null = null;
  private _message: any = null;
  private _connected: boolean = false;
  private _loading: boolean = false;
  private _error: any = null;
  private _readyState: number = WebSocket.CLOSED;

  // 自動再接続
  private _autoReconnect: boolean = false;
  private _reconnectInterval: number = 3000;
  private _maxReconnects: number = Infinity;
  private _reconnectCount: number = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _url: string = "";
  private _protocols: string | string[] | undefined = undefined;
  private _intentionalClose: boolean = false;

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
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

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      raiseError("WebSocket is not connected.");
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

    try {
      this._ws = this._protocols
        ? new WebSocket(this._url, this._protocols)
        : new WebSocket(this._url);
    } catch (e) {
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

  private _onOpen = (): void => {
    this._reconnectCount = 0;
    this._setLoading(false);
    this._setConnected(true);
    this._setReadyState(WebSocket.OPEN);
  };

  private _onMessage = (event: MessageEvent): void => {
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
    this._setError(event);
  };

  private _onClose = (event: CloseEvent): void => {
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

  private _scheduleReconnect(): void {
    this._clearReconnectTimer();
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
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
    this._ws!.removeEventListener("open", this._onOpen);
    this._ws!.removeEventListener("message", this._onMessage);
    this._ws!.removeEventListener("error", this._onError);
    this._ws!.removeEventListener("close", this._onClose);
  }

  private _closeInternal(): void {
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

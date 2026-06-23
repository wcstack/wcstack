import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketCore } from "../src/core/WebSocketCore";

// WebSocketモック
class MockWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  protocol = "";

  constructor(url: string, _protocols?: string | string[]) {
    super();
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send = vi.fn();
  close = vi.fn().mockImplementation(function (this: MockWebSocket) {
    this.readyState = MockWebSocket.CLOSING;
  });

  // テストヘルパー: openイベントを発火
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  // テストヘルパー: messageイベントを発火
  simulateMessage(data: any): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  // テストヘルパー: errorイベントを発火
  simulateError(): void {
    this.dispatchEvent(new Event("error"));
  }

  // テストヘルパー: closeイベントを発火
  simulateClose(code = 1000, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }

  static instances: MockWebSocket[] = [];
  static resetInstances(): void {
    MockWebSocket.instances = [];
  }
}

describe("WebSocketCore", () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    (globalThis as any).WebSocket = MockWebSocket;
    MockWebSocket.resetInstances();
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  it("EventTargetを継承している", () => {
    const core = new WebSocketCore();
    expect(core).toBeInstanceOf(EventTarget);
  });

  it("wcBindableプロパティが正しく定義されている", () => {
    expect(WebSocketCore.wcBindable.protocol).toBe("wc-bindable");
    expect(WebSocketCore.wcBindable.version).toBe(1);
    expect(WebSocketCore.wcBindable.properties).toHaveLength(5);
    expect(WebSocketCore.wcBindable.properties[0].name).toBe("message");
    expect(WebSocketCore.wcBindable.properties[1].name).toBe("connected");
    expect(WebSocketCore.wcBindable.properties[2].name).toBe("loading");
    expect(WebSocketCore.wcBindable.properties[3].name).toBe("error");
    expect(WebSocketCore.wcBindable.properties[4].name).toBe("readyState");
    expect(WebSocketCore.wcBindable.inputs).toBeUndefined();
    expect(WebSocketCore.wcBindable.commands?.map(command => command.name)).toEqual(["connect", "send", "close"]);
  });

  it("初期状態が正しい", () => {
    const core = new WebSocketCore();
    expect(core.message).toBeNull();
    expect(core.connected).toBe(false);
    expect(core.loading).toBe(false);
    expect(core.error).toBeNull();
    expect(core.readyState).toBe(WebSocket.CLOSED);
  });

  it("HTMLElementではなくEventTargetベースである", () => {
    const core = new WebSocketCore();
    expect(core).toBeInstanceOf(EventTarget);
    expect(core).not.toBeInstanceOf(HTMLElement);
  });

  describe("connect", () => {
    it("url未指定時は例外をスローせず error プロパティに流す", () => {
      const core = new WebSocketCore();
      const errors: any[] = [];
      core.addEventListener("wcs-ws:error", (e) => {
        errors.push((e as CustomEvent).detail);
      });

      expect(() => core.connect("")).not.toThrow();
      expect(core.error).toEqual({ message: "url is required." });
      expect(errors).toEqual([{ message: "url is required." }]);
      // 接続は開始されない
      expect(MockWebSocket.instances).toHaveLength(0);
    });

    it("WebSocket接続を開始する", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");

      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].url).toBe("ws://localhost:8080");
    });

    it("connectでbinaryTypeをソケットに適用する（既定はblob）", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      expect(MockWebSocket.instances[0].binaryType).toBe("blob");
    });

    it("connectでbinaryType=arraybufferをソケットに適用する", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080", { binaryType: "arraybuffer" });
      expect(MockWebSocket.instances[0].binaryType).toBe("arraybuffer");
    });

    it("接続開始時にloadingがtrueになる", () => {
      const core = new WebSocketCore();
      const events: boolean[] = [];
      core.addEventListener("wcs-ws:loading-changed", (e) => {
        events.push((e as CustomEvent).detail);
      });

      core.connect("ws://localhost:8080");
      expect(core.loading).toBe(true);
      expect(events).toEqual([true]);
    });

    it("接続開始時にreadyStateがCONNECTINGになる", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      expect(core.readyState).toBe(WebSocket.CONNECTING);
    });

    it("protocolsを指定して接続できる", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080", { protocols: "graphql-ws" });

      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it("既存の接続を閉じてから新しい接続を開始する", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      const firstWs = MockWebSocket.instances[0];
      firstWs.simulateOpen();

      core.connect("ws://localhost:9090");
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(firstWs.close).toHaveBeenCalled();
    });
  });

  describe("open", () => {
    it("open時にconnectedがtrueになる", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");

      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      expect(core.connected).toBe(true);
      expect(core.loading).toBe(false);
      expect(core.readyState).toBe(WebSocket.OPEN);
    });

    it("open時にイベントが発火する", () => {
      const core = new WebSocketCore();
      const connectedEvents: boolean[] = [];
      const loadingEvents: boolean[] = [];
      const errorEvents: any[] = [];

      core.addEventListener("wcs-ws:connected-changed", (e) => {
        connectedEvents.push((e as CustomEvent).detail);
      });
      core.addEventListener("wcs-ws:loading-changed", (e) => {
        loadingEvents.push((e as CustomEvent).detail);
      });
      core.addEventListener("wcs-ws:error", (e) => {
        errorEvents.push((e as CustomEvent).detail);
      });

      core.connect("ws://localhost:8080");
      MockWebSocket.instances[0].simulateOpen();

      expect(connectedEvents).toEqual([true]);
      // error null 通知 + loading true + loading false
      expect(loadingEvents).toEqual([true, false]);
      expect(errorEvents).toEqual([null]);
    });
  });

  describe("message", () => {
    it("テキストメッセージを受信する", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      MockWebSocket.instances[0].simulateOpen();

      const messages: any[] = [];
      core.addEventListener("wcs-ws:message", (e) => {
        messages.push((e as CustomEvent).detail);
      });

      MockWebSocket.instances[0].simulateMessage("hello");
      expect(core.message).toBe("hello");
      expect(messages).toEqual(["hello"]);
    });

    it("JSONメッセージを自動パースする", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      MockWebSocket.instances[0].simulateOpen();

      MockWebSocket.instances[0].simulateMessage('{"type":"ping","count":1}');
      expect(core.message).toEqual({ type: "ping", count: 1 });
    });

    it("不正なJSONはテキストとして扱う", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      MockWebSocket.instances[0].simulateOpen();

      MockWebSocket.instances[0].simulateMessage("{invalid json}");
      expect(core.message).toBe("{invalid json}");
    });

    it("非文字列データはそのまま保持する", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      MockWebSocket.instances[0].simulateOpen();

      const blob = new Blob(["test"]);
      MockWebSocket.instances[0].simulateMessage(blob);
      expect(core.message).toBe(blob);
    });
  });

  describe("send", () => {
    it("接続済みの場合にメッセージを送信する", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      MockWebSocket.instances[0].simulateOpen();

      core.send("hello");
      expect(MockWebSocket.instances[0].send).toHaveBeenCalledWith("hello");
    });

    it("未接続時は例外をスローせず error プロパティに流す", () => {
      const core = new WebSocketCore();
      const errors: any[] = [];
      core.addEventListener("wcs-ws:error", (e) => {
        errors.push((e as CustomEvent).detail);
      });

      expect(() => core.send("hello")).not.toThrow();
      expect(core.error).toEqual({ message: "WebSocket is not connected." });
      expect(errors).toEqual([{ message: "WebSocket is not connected." }]);
    });

    it("OPEN以外のreadyState（CONNECTING）でも送信せず error に流す", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      // simulateOpen を呼ばないため readyState は CONNECTING のまま
      core.send("hello");
      expect(MockWebSocket.instances[0].send).not.toHaveBeenCalled();
      expect(core.error).toEqual({ message: "WebSocket is not connected." });
    });
  });

  describe("close", () => {
    it("接続を閉じる", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      MockWebSocket.instances[0].simulateOpen();

      core.close();
      expect(MockWebSocket.instances[0].close).toHaveBeenCalled();
    });

    it("codeとreasonを指定して閉じる", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      MockWebSocket.instances[0].simulateOpen();

      core.close(1000, "normal closure");
      expect(MockWebSocket.instances[0].close).toHaveBeenCalledWith(1000, "normal closure");
    });

    it("close後にconnectedがfalseになる", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      MockWebSocket.instances[0].simulateOpen();

      core.close();
      MockWebSocket.instances[0].simulateClose();

      expect(core.connected).toBe(false);
      expect(core.readyState).toBe(WebSocket.CLOSED);
    });

    it("接続がない場合でもlistener除去で例外にならない", () => {
      const core = new WebSocketCore();

      expect(() => (core as any)._removeListeners()).not.toThrow();
    });
  });

  describe("error", () => {
    it("エラーイベントを処理する", () => {
      const core = new WebSocketCore();
      const errors: any[] = [];
      core.addEventListener("wcs-ws:error", (e) => {
        errors.push((e as CustomEvent).detail);
      });

      core.connect("ws://localhost:8080");
      // _doConnect で error=null 通知 + simulateError で error イベント
      MockWebSocket.instances[0].simulateError();

      expect(core.error).toBeTruthy();
      expect(errors).toHaveLength(2);
      expect(errors[0]).toBeNull();
      expect(errors[1]).toBeInstanceOf(Event);
    });
  });

  describe("target injection", () => {
    it("カスタムターゲットにイベントを発火する", () => {
      const customTarget = new EventTarget();
      const core = new WebSocketCore(customTarget);
      const messages: any[] = [];

      customTarget.addEventListener("wcs-ws:message", (e) => {
        messages.push((e as CustomEvent).detail);
      });

      core.connect("ws://localhost:8080");
      MockWebSocket.instances[0].simulateOpen();
      MockWebSocket.instances[0].simulateMessage("hello");

      expect(messages).toEqual(["hello"]);
    });
  });

  describe("auto-reconnect", () => {
    it("異常クローズ時に自動再接続する", () => {
      vi.useFakeTimers();
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080", {
        autoReconnect: true,
        reconnectInterval: 1000,
      });
      MockWebSocket.instances[0].simulateOpen();
      MockWebSocket.instances[0].simulateClose(1006, "abnormal");

      expect(MockWebSocket.instances).toHaveLength(1);

      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances).toHaveLength(2);
      vi.useRealTimers();
    });

    it("意図的なcloseでは再接続しない", () => {
      vi.useFakeTimers();
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080", {
        autoReconnect: true,
        reconnectInterval: 1000,
      });
      MockWebSocket.instances[0].simulateOpen();

      core.close();
      MockWebSocket.instances[0].simulateClose(1000, "normal");

      vi.advanceTimersByTime(5000);
      expect(MockWebSocket.instances).toHaveLength(1);
      vi.useRealTimers();
    });

    it("maxReconnectsを超えると再接続を停止する", () => {
      vi.useFakeTimers();
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080", {
        autoReconnect: true,
        reconnectInterval: 100,
        maxReconnects: 2,
      });
      MockWebSocket.instances[0].simulateOpen();

      // 1回目のクローズ → 再接続
      MockWebSocket.instances[0].simulateClose(1006);
      vi.advanceTimersByTime(100);
      expect(MockWebSocket.instances).toHaveLength(2);

      // 2回目のクローズ → 再接続
      MockWebSocket.instances[1].simulateClose(1006);
      vi.advanceTimersByTime(100);
      expect(MockWebSocket.instances).toHaveLength(3);

      // 3回目のクローズ → 再接続しない（maxReconnects=2に到達）
      MockWebSocket.instances[2].simulateClose(1006);
      vi.advanceTimersByTime(100);
      expect(MockWebSocket.instances).toHaveLength(3);
      vi.useRealTimers();
    });

    it("再接続成功時にカウンターがリセットされる", () => {
      vi.useFakeTimers();
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080", {
        autoReconnect: true,
        reconnectInterval: 100,
        maxReconnects: 2,
      });
      MockWebSocket.instances[0].simulateOpen();

      // クローズ → 再接続
      MockWebSocket.instances[0].simulateClose(1006);
      vi.advanceTimersByTime(100);
      expect(MockWebSocket.instances).toHaveLength(2);

      // 再接続成功 → カウンターリセット
      MockWebSocket.instances[1].simulateOpen();

      // 再度クローズ → 再接続可能（カウンターリセット済み）
      MockWebSocket.instances[1].simulateClose(1006);
      vi.advanceTimersByTime(100);
      expect(MockWebSocket.instances).toHaveLength(3);
      vi.useRealTimers();
    });

    it("新しいconnect呼び出しで再接続タイマーがクリアされる", () => {
      vi.useFakeTimers();
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080", {
        autoReconnect: true,
        reconnectInterval: 1000,
      });
      MockWebSocket.instances[0].simulateOpen();
      MockWebSocket.instances[0].simulateClose(1006);

      // 再接続タイマーが設定されている状態で新しいconnect
      core.connect("ws://localhost:9090");

      // 元のタイマーが発火しても追加の接続は作られない
      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances).toHaveLength(2);
      vi.useRealTimers();
    });
  });

  describe("CLOSED状態での再接続", () => {
    it("CLOSED状態のWebSocketに対してcloseを呼ばない", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      const firstWs = MockWebSocket.instances[0];

      // CLOSEDにする
      firstWs.simulateClose();

      // 再接続（CLOSED状態のWSに対してclose()は呼ばれない）
      core.connect("ws://localhost:9090");
      expect(firstWs.close).not.toHaveBeenCalled();
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it("CLOSING状態のWebSocketに対してcloseを呼ばない", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      const firstWs = MockWebSocket.instances[0];
      firstWs.simulateOpen();

      // CLOSINGにする（close()を呼ぶとreadyStateがCLOSINGになる）
      firstWs.close();
      expect(firstWs.readyState).toBe(MockWebSocket.CLOSING);
      firstWs.close.mockClear();

      // 再接続（CLOSING状態のWSに対してclose()は呼ばれない）
      core.connect("ws://localhost:9090");
      expect(firstWs.close).not.toHaveBeenCalled();
      expect(MockWebSocket.instances).toHaveLength(2);
    });
  });

  describe("再接続時の状態リセット", () => {
    it("コンストラ��タ例外時にconnectedがfalseにリセットされる", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      MockWebSocket.instances[0].simulateOpen();
      expect(core.connected).toBe(true);

      // 2回目の接続でコンストラクタが例外を投げる
      (globalThis as any).WebSocket = class {
        constructor() { throw new Error("connection failed"); }
      };
      (globalThis as any).WebSocket.CONNECTING = 0;
      (globalThis as any).WebSocket.OPEN = 1;
      (globalThis as any).WebSocket.CLOSING = 2;
      (globalThis as any).WebSocket.CLOSED = 3;

      core.connect("ws://fail");
      // connected は false にリセットされている
      expect(core.connected).toBe(false);
      expect(core.readyState).toBe(WebSocket.CLOSED);
      expect(core.error).toBeTruthy();
    });

    it("再接続時にerror nullがイベント通知される", () => {
      const core = new WebSocketCore();
      const errorEvents: any[] = [];
      core.addEventListener("wcs-ws:error", (e) => {
        errorEvents.push((e as CustomEvent).detail);
      });

      core.connect("ws://localhost:8080");
      MockWebSocket.instances[0].simulateError();
      expect(errorEvents).toHaveLength(2); // null (from _doConnect) + error event

      // 再接続時にerror=nullのイベントが発火
      errorEvents.length = 0;
      core.connect("ws://localhost:8080");
      expect(errorEvents[0]).toBeNull();
    });
  });

  describe("正常クローズでの再接続抑制", () => {
    it("サーバーからの正常クロ���ズ(1000)では再接続しない", () => {
      vi.useFakeTimers();
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080", {
        autoReconnect: true,
        reconnectInterval: 100,
      });
      MockWebSocket.instances[0].simulateOpen();

      // サーバー側が正常に切断 (code: 1000)
      MockWebSocket.instances[0].simulateClose(1000, "normal");

      vi.advanceTimersByTime(1000);
      // 再接続されない
      expect(MockWebSocket.instances).toHaveLength(1);
      vi.useRealTimers();
    });

    it("異常クローズ(1006)では再接続する", () => {
      vi.useFakeTimers();
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080", {
        autoReconnect: true,
        reconnectInterval: 100,
      });
      MockWebSocket.instances[0].simulateOpen();

      // 異常切断 (code: 1006)
      MockWebSocket.instances[0].simulateClose(1006, "abnormal");

      vi.advanceTimersByTime(100);
      expect(MockWebSocket.instances).toHaveLength(2);
      vi.useRealTimers();
    });

    it("異常クローズ(1011)では再接続する", () => {
      vi.useFakeTimers();
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080", {
        autoReconnect: true,
        reconnectInterval: 100,
      });
      MockWebSocket.instances[0].simulateOpen();

      MockWebSocket.instances[0].simulateClose(1011, "internal error");

      vi.advanceTimersByTime(100);
      expect(MockWebSocket.instances).toHaveLength(2);
      vi.useRealTimers();
    });
  });

  describe("ライフサイクル (ready/observe/dispose)", () => {
    it("ready は即座に解決する Promise を返す", async () => {
      const core = new WebSocketCore();
      await expect(core.ready).resolves.toBeUndefined();
    });

    it("observe は ready と同じ Promise を返す（no-op）", () => {
      const core = new WebSocketCore();
      expect(core.observe()).toBe(core.ready);
    });

    it("dispose は接続を閉じる", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      core.dispose();
      expect(MockWebSocket.instances[0].close).toHaveBeenCalled();
    });

    it("dispose 後に発火した open イベントは状態を書き換えない（_gen ガード）", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      const ws = MockWebSocket.instances[0];

      // dispose() は _gen を bump し close() する。close() はリスナを除去しないため、
      // 以降に古いソケットへ発火したイベントはハンドラに届くが stale gen で握り潰される。
      core.dispose();
      ws.simulateOpen();
      expect(core.connected).toBe(false);
    });

    it("dispose 後に発火した message イベントは message を書き換えない（_gen ガード）", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      const ws = MockWebSocket.instances[0];
      core.dispose();
      ws.simulateMessage("late");
      expect(core.message).toBeNull();
    });

    it("dispose 後に発火した error イベントは error を書き換えない（_gen ガード）", () => {
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080");
      const ws = MockWebSocket.instances[0];
      core.dispose();
      const errorBefore = core.error;
      ws.simulateError();
      expect(core.error).toBe(errorBefore);
    });

    it("dispose 後に発火した close イベントは状態を書き換えず再接続もしない（_gen ガード）", () => {
      vi.useFakeTimers();
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080", {
        autoReconnect: true,
        reconnectInterval: 1000,
      });
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      expect(core.connected).toBe(true);

      // dispose() は _gen を bump し close() する。mock の close() は close イベントを
      // 発火しないため connected/readyState はこの時点で OPEN のまま残る。close はリスナを
      // 除去しないので、ブラウザが後から close を返すケースを simulateClose で再現できる。
      core.dispose();
      expect(core.connected).toBe(true);
      expect(core.readyState).toBe(WebSocket.OPEN);

      ws.simulateClose(1006);
      vi.advanceTimersByTime(1000);
      // stale gen のため _onClose は早期 return し、状態も再接続も変わらない
      expect(core.connected).toBe(true);
      expect(core.readyState).toBe(WebSocket.OPEN);
      expect(MockWebSocket.instances).toHaveLength(1);
      vi.useRealTimers();
    });

    it("dispose で再接続タイマーがクリアされ再接続しない", () => {
      vi.useFakeTimers();
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080", {
        autoReconnect: true,
        reconnectInterval: 1000,
      });
      MockWebSocket.instances[0].simulateOpen();
      MockWebSocket.instances[0].simulateClose(1006);

      // 再接続タイマーが設定されている状態で dispose
      core.dispose();

      vi.advanceTimersByTime(1000);
      // dispose() が close() 経由でタイマーをクリアするため再接続は発火しない
      expect(MockWebSocket.instances).toHaveLength(1);
      vi.useRealTimers();
    });

    it("世代が古くなった再接続タイマーは発火しても再接続しない", () => {
      vi.useFakeTimers();
      const core = new WebSocketCore();
      core.connect("ws://localhost:8080", {
        autoReconnect: true,
        reconnectInterval: 1000,
      });
      MockWebSocket.instances[0].simulateOpen();
      MockWebSocket.instances[0].simulateClose(1006);

      // タイマー本体（gen ガード分岐）を踏むため、タイマーをクリアせずに
      // gen だけを進める（dispose/connect はタイマーをクリアしてしまうため直接操作）
      (core as any)._gen++;

      vi.advanceTimersByTime(1000);
      // 捕捉した gen が stale になり、タイマーコールバックは再接続せず return する
      expect(MockWebSocket.instances).toHaveLength(1);
      vi.useRealTimers();
    });
  });

  describe("WebSocket constructor エラー", () => {
    it("WebSocketコンストラクタのエラーを処理する", () => {
      (globalThis as any).WebSocket = class {
        constructor() { throw new Error("Invalid URL"); }
      };
      (globalThis as any).WebSocket.CONNECTING = 0;
      (globalThis as any).WebSocket.OPEN = 1;
      (globalThis as any).WebSocket.CLOSING = 2;
      (globalThis as any).WebSocket.CLOSED = 3;

      const core = new WebSocketCore();
      const errors: any[] = [];
      core.addEventListener("wcs-ws:error", (e) => {
        errors.push((e as CustomEvent).detail);
      });

      core.connect("invalid://url");
      expect(core.loading).toBe(false);
      // error=null 通知 + コンストラクタ例外
      expect(errors).toHaveLength(2);
      expect(errors[0]).toBeNull();
      expect(errors[1]).toBeInstanceOf(Error);
    });
  });
});

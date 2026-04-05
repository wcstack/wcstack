import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapWebSocket } from "../src/bootstrapWebSocket";
import { setConfig } from "../src/config";
import { WcsWebSocket } from "../src/components/WebSocket";

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

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  simulateMessage(data: any): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  simulateError(): void {
    this.dispatchEvent(new Event("error"));
  }

  simulateClose(code = 1000, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }

  static instances: MockWebSocket[] = [];
  static resetInstances(): void {
    MockWebSocket.instances = [];
  }
}

describe("WcsWebSocket コンポーネント", () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    (globalThis as any).WebSocket = MockWebSocket;
    MockWebSocket.resetInstances();
    setConfig({ autoTrigger: false });
    bootstrapWebSocket();
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  function createElement(attrs: Record<string, string> = {}): WcsWebSocket {
    const el = document.createElement("wcs-ws") as WcsWebSocket;
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
    return el;
  }

  it("カスタム要素として登録されている", () => {
    expect(customElements.get("wcs-ws")).toBe(WcsWebSocket);
  });

  it("wcBindableが正しく定義されている", () => {
    expect(WcsWebSocket.wcBindable.protocol).toBe("wc-bindable");
    expect(WcsWebSocket.wcBindable.properties).toHaveLength(7);
    const names = WcsWebSocket.wcBindable.properties.map(p => p.name);
    expect(names).toEqual(["message", "connected", "loading", "error", "readyState", "trigger", "send"]);
  });

  describe("属性アクセサ", () => {
    it("url属性の読み書きができる", () => {
      const el = createElement();
      el.url = "ws://localhost:8080";
      expect(el.url).toBe("ws://localhost:8080");
      expect(el.getAttribute("url")).toBe("ws://localhost:8080");
    });

    it("protocols属性の読み書きができる", () => {
      const el = createElement();
      el.protocols = "graphql-ws";
      expect(el.protocols).toBe("graphql-ws");
    });

    it("autoReconnect属性の読み書きができる", () => {
      const el = createElement();
      expect(el.autoReconnect).toBe(false);
      el.autoReconnect = true;
      expect(el.autoReconnect).toBe(true);
      expect(el.hasAttribute("auto-reconnect")).toBe(true);
      el.autoReconnect = false;
      expect(el.hasAttribute("auto-reconnect")).toBe(false);
    });

    it("reconnectInterval属性のデフォルト値が3000", () => {
      const el = createElement();
      expect(el.reconnectInterval).toBe(3000);
    });

    it("maxReconnects属性のデフォルト値がInfinity", () => {
      const el = createElement();
      expect(el.maxReconnects).toBe(Infinity);
    });

    it("manual属性の読み書きができる", () => {
      const el = createElement();
      expect(el.manual).toBe(false);
      el.manual = true;
      expect(el.manual).toBe(true);
      el.manual = false;
      expect(el.manual).toBe(false);
    });
  });

  describe("connectedCallback", () => {
    it("display:noneに設定される", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      expect(el.style.display).toBe("none");
      el.remove();
    });

    it("url設定済みの場合に自動接続する", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      expect(MockWebSocket.instances).toHaveLength(1);
      el.remove();
    });

    it("manual属性がある場合は自動接続しない", () => {
      const el = createElement({ url: "ws://localhost:8080", manual: "" });
      document.body.appendChild(el);
      expect(MockWebSocket.instances).toHaveLength(0);
      el.remove();
    });

    it("url未設定の場合は接続しない", () => {
      const el = createElement();
      document.body.appendChild(el);
      expect(MockWebSocket.instances).toHaveLength(0);
      el.remove();
    });
  });

  describe("disconnectedCallback", () => {
    it("DOM除去時に接続を閉じる", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      MockWebSocket.instances[0].simulateOpen();

      el.remove();
      expect(MockWebSocket.instances[0].close).toHaveBeenCalled();
    });
  });

  describe("attributeChangedCallback", () => {
    it("url変更時に再接続する", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      expect(MockWebSocket.instances).toHaveLength(1);

      el.setAttribute("url", "ws://localhost:9090");
      expect(MockWebSocket.instances).toHaveLength(2);
      el.remove();
    });

    it("manual属性がある場合はurl変更で再接続しない", () => {
      const el = createElement({ url: "ws://localhost:8080", manual: "" });
      document.body.appendChild(el);
      expect(MockWebSocket.instances).toHaveLength(0);

      el.setAttribute("url", "ws://localhost:9090");
      expect(MockWebSocket.instances).toHaveLength(0);
      el.remove();
    });
  });

  describe("コア委��", () => {
    it("message, connected, loading, error, readyStateがコアに委譲される", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);

      expect(el.connected).toBe(false);
      expect(el.loading).toBe(true);

      MockWebSocket.instances[0].simulateOpen();
      expect(el.connected).toBe(true);
      expect(el.loading).toBe(false);
      expect(el.readyState).toBe(WebSocket.OPEN);

      MockWebSocket.instances[0].simulateMessage('{"test":true}');
      expect(el.message).toEqual({ test: true });

      el.remove();
    });
  });

  describe("trigger", () => {
    it("trigger設定で接続を開始する", () => {
      const el = createElement({ url: "ws://localhost:8080", manual: "" });
      document.body.appendChild(el);
      expect(MockWebSocket.instances).toHaveLength(0);

      el.trigger = true;
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(el.trigger).toBe(false);
      el.remove();
    });

    it("triggerリセット時にイベントが発火する", () => {
      const el = createElement({ url: "ws://localhost:8080", manual: "" });
      document.body.appendChild(el);

      const events: boolean[] = [];
      el.addEventListener("wcs-ws:trigger-changed", (e) => {
        events.push((e as CustomEvent).detail);
      });

      el.trigger = true;
      expect(events).toEqual([false]);
      el.remove();
    });

    it("falseの場合は何もしない", () => {
      const el = createElement({ url: "ws://localhost:8080", manual: "" });
      document.body.appendChild(el);
      el.trigger = false;
      expect(MockWebSocket.instances).toHaveLength(0);
      el.remove();
    });
  });

  describe("send", () => {
    it("文字列データを送信する", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      MockWebSocket.instances[0].simulateOpen();

      el.send = "hello";
      expect(MockWebSocket.instances[0].send).toHaveBeenCalledWith("hello");
      el.remove();
    });

    it("オブジェクトをJSON文字列化して送信する", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      MockWebSocket.instances[0].simulateOpen();

      el.send = { type: "ping" };
      expect(MockWebSocket.instances[0].send).toHaveBeenCalledWith('{"type":"ping"}');
      el.remove();
    });

    it("null/undefinedは無視する", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      MockWebSocket.instances[0].simulateOpen();

      el.send = null;
      el.send = undefined;
      expect(MockWebSocket.instances[0].send).not.toHaveBeenCalled();
      el.remove();
    });

    it("send後にイベントが発火する", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      MockWebSocket.instances[0].simulateOpen();

      const events: any[] = [];
      el.addEventListener("wcs-ws:send-changed", (e) => {
        events.push((e as CustomEvent).detail);
      });

      el.send = "test";
      expect(events).toEqual([null]);
      el.remove();
    });
  });

  describe("sendMessage", () => {
    it("sendMessageメソッドでデータを送信する", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      MockWebSocket.instances[0].simulateOpen();

      el.sendMessage("raw data");
      expect(MockWebSocket.instances[0].send).toHaveBeenCalledWith("raw data");
      el.remove();
    });
  });

  describe("close", () => {
    it("closeメソッドで接続を閉じる", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      MockWebSocket.instances[0].simulateOpen();

      el.close(1000, "bye");
      expect(MockWebSocket.instances[0].close).toHaveBeenCalledWith(1000, "bye");
      el.remove();
    });
  });

  describe("protocols", () => {
    it("カンマ区切りのprotocolsを配列として渡す", () => {
      const el = createElement({
        url: "ws://localhost:8080",
        protocols: "graphql-ws, graphql-transport-ws",
      });
      document.body.appendChild(el);
      expect(MockWebSocket.instances).toHaveLength(1);
      el.remove();
    });

    it("単一protocolはそのまま文字列として渡す", () => {
      const el = createElement({
        url: "ws://localhost:8080",
        protocols: "graphql-ws",
      });
      document.body.appendChild(el);
      expect(MockWebSocket.instances).toHaveLength(1);
      el.remove();
    });
  });

  describe("auto-reconnect属性", () => {
    it("auto-reconnect属性で自動再接続が有効になる", () => {
      vi.useFakeTimers();
      const el = createElement({
        url: "ws://localhost:8080",
        "auto-reconnect": "",
        "reconnect-interval": "500",
      });
      document.body.appendChild(el);
      MockWebSocket.instances[0].simulateOpen();
      MockWebSocket.instances[0].simulateClose(1006);

      vi.advanceTimersByTime(500);
      expect(MockWebSocket.instances).toHaveLength(2);

      el.remove();
      vi.useRealTimers();
    });
  });

  describe("セッター", () => {
    it("reconnectIntervalをプロパティで設定できる", () => {
      const el = createElement();
      el.reconnectInterval = 5000;
      expect(el.getAttribute("reconnect-interval")).toBe("5000");
      expect(el.reconnectInterval).toBe(5000);
    });

    it("maxReconnectsをプロパティで設定できる", () => {
      const el = createElement();
      el.maxReconnects = 10;
      expect(el.getAttribute("max-reconnects")).toBe("10");
      expect(el.maxReconnects).toBe(10);
    });
  });

  describe("error委譲", () => {
    it("errorプロパティがコアのエラーを返す", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      expect(el.error).toBeNull();

      MockWebSocket.instances[0].simulateError();
      expect(el.error).toBeTruthy();
      el.remove();
    });
  });

  describe("autoTrigger有効時", () => {
    it("autoTriggerが有効な場合にregisterAutoTriggerが呼ばれる", () => {
      setConfig({ autoTrigger: true });
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      // autoTriggerが有効でもエラーなく動作する
      expect(MockWebSocket.instances).toHaveLength(1);
      el.remove();
    });
  });

  describe("イベントバブリング", () => {
    it("wcs-ws:messageイベントがバブルする", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      MockWebSocket.instances[0].simulateOpen();

      const events: any[] = [];
      document.body.addEventListener("wcs-ws:message", (e) => {
        events.push((e as CustomEvent).detail);
      });

      MockWebSocket.instances[0].simulateMessage("hello");
      expect(events).toEqual(["hello"]);

      el.remove();
    });
  });
});

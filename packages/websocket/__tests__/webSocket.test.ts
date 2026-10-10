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
    expect(WcsWebSocket.wcBindable.properties).toHaveLength(8);
    const names = WcsWebSocket.wcBindable.properties.map(p => p.name);
    expect(names).toEqual(["message", "connected", "loading", "error", "errorInfo", "readyState", "trigger", "send"]);
    expect(WcsWebSocket.wcBindable.inputs?.map(input => input.name)).toEqual([
      "url", "protocols", "autoReconnect", "reconnectInterval", "maxReconnects", "binaryType", "manual", "trigger", "send"
    ]);
    expect(WcsWebSocket.wcBindable.commands?.map(command => command.name)).toEqual(["connect", "sendMessage", "close"]);
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

    it("reconnectInterval属性が不正な数値の場合はデフォルト値を返す", () => {
      const el = createElement({ "reconnect-interval": "abc" });
      expect(el.reconnectInterval).toBe(3000);
    });

    it("maxReconnects属性のデフォルト値がInfinity", () => {
      const el = createElement();
      expect(el.maxReconnects).toBe(Infinity);
    });

    it("maxReconnects属性が不正な数値の場合はデフォルト値を返す", () => {
      const el = createElement({ "max-reconnects": "abc" });
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

    it("binaryType属性の読み書き・デフォルト・正規化", () => {
      const el = createElement();
      expect(el.binaryType).toBe("blob");
      el.binaryType = "arraybuffer";
      expect(el.getAttribute("binary-type")).toBe("arraybuffer");
      expect(el.binaryType).toBe("arraybuffer");
      el.binaryType = "garbage";
      expect(el.binaryType).toBe("blob");
      el.binaryType = null;
      expect(el.hasAttribute("binary-type")).toBe(false);
      expect(el.binaryType).toBe("blob");
    });

    it("undefined はマークアップに書かれた属性へ戻し、null は属性を外す（P1 / P2）", () => {
      const host = document.createElement("div");
      host.innerHTML = '<wcs-ws url="ws://authored" protocols="graphql-ws" auto-reconnect reconnect-interval="500" max-reconnects="2" binary-type="arraybuffer" manual></wcs-ws>';
      const el = host.firstElementChild as WcsWebSocket;
      el.url = "ws://bound";
      el.protocols = "a,b";
      el.autoReconnect = false;
      el.reconnectInterval = 100;
      el.maxReconnects = 9;
      el.binaryType = "blob";
      el.manual = false;
      el.url = undefined;
      el.protocols = undefined;
      el.autoReconnect = undefined;
      el.reconnectInterval = undefined;
      el.maxReconnects = undefined;
      el.binaryType = undefined;
      el.manual = undefined;
      expect(el.url).toBe("ws://authored");
      expect(el.protocols).toBe("graphql-ws");
      expect(el.autoReconnect).toBe(true);
      expect(el.reconnectInterval).toBe(500);
      expect(el.maxReconnects).toBe(2);
      expect(el.binaryType).toBe("arraybuffer");
      expect(el.manual).toBe(true);
      el.url = null;
      el.protocols = null;
      el.autoReconnect = null;
      el.reconnectInterval = null;
      el.maxReconnects = null;
      el.binaryType = null;
      el.manual = null;
      expect(el.hasAttribute("url")).toBe(false);
      expect(el.hasAttribute("protocols")).toBe(false);
      expect(el.autoReconnect).toBe(false);
      expect(el.hasAttribute("reconnect-interval")).toBe(false);
      expect(el.reconnectInterval).toBe(3000);
      expect(el.hasAttribute("max-reconnects")).toBe(false);
      expect(el.maxReconnects).toBe(Infinity);
      expect(el.binaryType).toBe("blob");
      expect(el.manual).toBe(false);
    });

    it("接続中の url に undefined を書くとマークアップの url で張り直し、null では接続しない", () => {
      const host = document.createElement("div");
      host.innerHTML = '<wcs-ws url="ws://localhost:8080"></wcs-ws>';
      const el = host.firstElementChild as WcsWebSocket;
      document.body.appendChild(host);
      el.url = "ws://localhost:9090";
      el.url = undefined;
      expect(MockWebSocket.instances.map((ws) => ws.url))
        .toEqual(["ws://localhost:8080", "ws://localhost:9090", "ws://localhost:8080"]);
      el.url = null;
      expect(el.hasAttribute("url")).toBe(false);
      expect(MockWebSocket.instances).toHaveLength(3);
      host.remove();
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

    it("接続時にソケットへbinaryTypeを反映する（既定はblob）", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      expect((MockWebSocket.instances[0] as unknown as { binaryType: string }).binaryType).toBe("blob");
      el.remove();
    });

    it("binary-type=arraybufferを接続時にソケットへ反映する", () => {
      const el = createElement({ url: "ws://localhost:8080", "binary-type": "arraybuffer" });
      document.body.appendChild(el);
      expect((MockWebSocket.instances[0] as unknown as { binaryType: string }).binaryType).toBe("arraybuffer");
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
    it("DOM除去時に接続を閉じる（dispose 経由）", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      MockWebSocket.instances[0].simulateOpen();

      el.remove();
      expect(MockWebSocket.instances[0].close).toHaveBeenCalled();
    });

    it("DOM除去後に発火したメッセージは状態を書き換えない（dispose の _gen ガード）", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      el.remove();
      ws.simulateMessage("late");
      expect(el.message).toBeNull();
    });
  });

  describe("SSR / connectedCallbackPromise", () => {
    it("hasConnectedCallbackPromise が true である", () => {
      expect(WcsWebSocket.hasConnectedCallbackPromise).toBe(true);
    });

    it("初期状態の connectedCallbackPromise は解決済み Promise を返す", async () => {
      const el = createElement();
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    });

    it("connectedCallback で connectedCallbackPromise が observe() の結果に設定される", async () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
      el.remove();
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

    it("url以外の属性名では何もしない", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      el.attributeChangedCallback("protocols", null, "graphql-ws");
      expect(MockWebSocket.instances).toHaveLength(1);
      el.remove();
    });
  });

  // 二重接続の回帰: url 属性の同じ値の書き込みや、upgrade 時の attributeChangedCallback で
  // 接続し直すと、ソケットを 2 本張って 1 本目を CONNECTING のまま閉じていた
  describe("接続は1本だけ", () => {
    /**
     * 文書の中にある要素の upgrade を、ブラウザと同じ順で再現する。happy-dom は define 時に
     * 要素を差し替えて connectedCallback だけを呼ぶ（その場の upgrade も、既存の属性の
     * attributeChangedCallback も無い）ので、仕様の手順を直接たどる:
     * 文書に接続されたまま、観測する属性ごとに attributeChangedCallback(name, null, value)、
     * 続けて connectedCallback。upgrade 前の代入は、accessor を隠す own データプロパティになる。
     */
    function simulateUpgrade(attrs: Record<string, string>, ownProps: Record<string, unknown> = {}): WcsWebSocket {
      const el = createElement(attrs);
      for (const [name, value] of Object.entries(ownProps)) {
        Object.defineProperty(el, name, { value, writable: true, configurable: true, enumerable: true });
      }
      Object.defineProperty(el, "isConnected", { configurable: true, get: () => true });
      for (const name of WcsWebSocket.observedAttributes) {
        if (el.hasAttribute(name)) el.attributeChangedCallback(name, null, el.getAttribute(name));
      }
      el.connectedCallback();
      return el;
    }

    /** simulateUpgrade した要素を切り離したことにする */
    function detach(el: WcsWebSocket): void {
      delete (el as unknown as { isConnected?: boolean }).isConnected;
      el.disconnectedCallback();
    }

    it("同じ値のurl属性の書き込みでは再接続しない", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      expect(MockWebSocket.instances).toHaveLength(1);

      el.setAttribute("url", "ws://localhost:8080");
      el.url = "ws://localhost:8080";
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].close).not.toHaveBeenCalled();
      el.remove();
    });

    it("urlのsetterに続く同じ値の属性ミラー（@wcstack/state の inputs[].attribute）でも1本", () => {
      const el = createElement();
      document.body.appendChild(el);
      expect(MockWebSocket.instances).toHaveLength(0);

      // state はプロパティを書いてから、宣言された属性へ同じ値を書く
      el.url = "ws://localhost:8080";
      el.setAttribute("url", "ws://localhost:8080");
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].close).not.toHaveBeenCalled();
      el.remove();
    });

    it("urlが変わったときは1回だけ再接続し、続く同じ値の書き込みでは再接続しない", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);

      el.url = "ws://localhost:9090";
      el.setAttribute("url", "ws://localhost:9090");
      expect(MockWebSocket.instances.map((ws) => ws.url)).toEqual(["ws://localhost:8080", "ws://localhost:9090"]);
      expect(MockWebSocket.instances[0].close).toHaveBeenCalledTimes(1);
      expect(MockWebSocket.instances[1].close).not.toHaveBeenCalled();
      el.remove();
    });

    it("url属性を持つ要素がupgradeされると1本だけ張る", () => {
      const el = simulateUpgrade({ url: "ws://localhost:8080" });
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].url).toBe("ws://localhost:8080");
      expect(MockWebSocket.instances[0].close).not.toHaveBeenCalled();
      detach(el);
    });

    it("upgrade前に代入されたurlプロパティも、取り込んで1本だけ張る", () => {
      const el = simulateUpgrade({}, { url: "ws://localhost:7070" });
      expect(Object.prototype.hasOwnProperty.call(el, "url")).toBe(false);
      expect(el.getAttribute("url")).toBe("ws://localhost:7070");
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].url).toBe("ws://localhost:7070");
      detach(el);
    });

    it("upgrade前に代入されたmanualも、接続の判断より先に取り込む", () => {
      const el = simulateUpgrade({}, { url: "ws://localhost:7070", manual: true });
      expect(el.manual).toBe(true);
      expect(MockWebSocket.instances).toHaveLength(0);
      detach(el);
    });

    it("upgradeの後のurl変更は従来どおり再接続する", () => {
      const el = simulateUpgrade({ url: "ws://localhost:8080" });
      el.setAttribute("url", "ws://localhost:9090");
      expect(MockWebSocket.instances.map((ws) => ws.url)).toEqual(["ws://localhost:8080", "ws://localhost:9090"]);
      detach(el);
      expect(MockWebSocket.instances[1].close).toHaveBeenCalled();
    });

    it("DOMの外でのurl変更は接続せず、戻したときにそのurlで1本張る", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      el.remove();
      expect(MockWebSocket.instances[0].close).toHaveBeenCalled();

      el.setAttribute("url", "ws://localhost:9090");
      expect(MockWebSocket.instances).toHaveLength(1);

      document.body.appendChild(el);
      expect(MockWebSocket.instances.map((ws) => ws.url)).toEqual(["ws://localhost:8080", "ws://localhost:9090"]);
      el.remove();
    });

    it("manual と auto-reconnect の真偽属性のミラーは接続に触れない", () => {
      vi.useFakeTimers();
      const el = createElement({ url: "ws://localhost:8080", "reconnect-interval": "500" });
      document.body.appendChild(el);
      expect(MockWebSocket.instances).toHaveLength(1);

      // state は真偽値を HTML の真偽属性として写す（true → ""、false → 削除）
      el.autoReconnect = true;
      el.setAttribute("auto-reconnect", "");
      el.manual = true;
      el.setAttribute("manual", "");
      el.manual = false;
      el.removeAttribute("manual");
      expect(MockWebSocket.instances).toHaveLength(1);

      // auto-reconnect はこれまでどおり次の connect() から効く
      el.setAttribute("url", "ws://localhost:9090");
      expect(MockWebSocket.instances).toHaveLength(2);
      MockWebSocket.instances[1].simulateOpen();
      MockWebSocket.instances[1].simulateClose(1006);
      vi.advanceTimersByTime(500);
      expect(MockWebSocket.instances).toHaveLength(3);
      expect(MockWebSocket.instances[2].url).toBe("ws://localhost:9090");

      el.remove();
      vi.useRealTimers();
    });

    it("trigger と connect() は同じurlでも従来どおり接続し直す", () => {
      const el = createElement({ url: "ws://localhost:8080", manual: "" });
      document.body.appendChild(el);
      el.trigger = true;
      el.connect();
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(MockWebSocket.instances[0].close).toHaveBeenCalledTimes(1);
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

    it("send getter は常に null を返す（write-only）", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      expect(el.send).toBeNull();
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

    it("errorInfo が Shell ゲッター経由で Core から読み取れる", () => {
      const el = createElement({ url: "ws://localhost:8080" });
      document.body.appendChild(el);
      expect(el.errorInfo).toBeNull();

      MockWebSocket.instances[0].simulateError(); // error Event → connection-error
      expect(el.errorInfo).toEqual({
        code: "connection-error", phase: "execute", recoverable: true, message: "WebSocket connection error",
      });
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

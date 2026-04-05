import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapWebSocket } from "../src/bootstrapWebSocket";
import { setConfig } from "../src/config";
import { WcsWebSocket } from "../src/components/WebSocket";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";

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
  close = vi.fn();

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
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

describe("autoTrigger", () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    (globalThis as any).WebSocket = MockWebSocket;
    MockWebSocket.resetInstances();
    setConfig({ autoTrigger: false });
    bootstrapWebSocket();
  });

  afterEach(() => {
    unregisterAutoTrigger();
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  it("data-wstarget属性のクリックで接続を開始する", () => {
    registerAutoTrigger();

    const el = document.createElement("wcs-ws") as WcsWebSocket;
    el.setAttribute("url", "ws://localhost:8080");
    el.setAttribute("manual", "");
    el.setAttribute("id", "my-ws");
    document.body.appendChild(el);

    const button = document.createElement("button");
    button.setAttribute("data-wstarget", "my-ws");
    document.body.appendChild(button);

    button.click();
    expect(MockWebSocket.instances).toHaveLength(1);

    el.remove();
    button.remove();
  });

  it("存在しないIDの場合は何もしない", () => {
    registerAutoTrigger();

    const button = document.createElement("button");
    button.setAttribute("data-wstarget", "nonexistent");
    document.body.appendChild(button);

    button.click();
    expect(MockWebSocket.instances).toHaveLength(0);

    button.remove();
  });

  it("空のtriggerAttribute値の場合は何もしない", () => {
    registerAutoTrigger();

    const button = document.createElement("button");
    button.setAttribute("data-wstarget", "");
    document.body.appendChild(button);

    button.click();
    expect(MockWebSocket.instances).toHaveLength(0);

    button.remove();
  });

  it("wcs-ws以外の要素では発火しない", () => {
    registerAutoTrigger();

    const div = document.createElement("div");
    div.setAttribute("id", "not-ws");
    document.body.appendChild(div);

    const button = document.createElement("button");
    button.setAttribute("data-wstarget", "not-ws");
    document.body.appendChild(button);

    button.click();
    expect(MockWebSocket.instances).toHaveLength(0);

    div.remove();
    button.remove();
  });

  it("unregisterAutoTriggerでリスナーが解除される", () => {
    registerAutoTrigger();
    unregisterAutoTrigger();

    const el = document.createElement("wcs-ws") as WcsWebSocket;
    el.setAttribute("url", "ws://localhost:8080");
    el.setAttribute("manual", "");
    el.setAttribute("id", "my-ws2");
    document.body.appendChild(el);

    const button = document.createElement("button");
    button.setAttribute("data-wstarget", "my-ws2");
    document.body.appendChild(button);

    button.click();
    expect(MockWebSocket.instances).toHaveLength(0);

    el.remove();
    button.remove();
  });

  it("registerAutoTriggerを複数回呼んでも重複登録しない", () => {
    registerAutoTrigger();
    registerAutoTrigger();

    const el = document.createElement("wcs-ws") as WcsWebSocket;
    el.setAttribute("url", "ws://localhost:8080");
    el.setAttribute("manual", "");
    el.setAttribute("id", "my-ws3");
    document.body.appendChild(el);

    const button = document.createElement("button");
    button.setAttribute("data-wstarget", "my-ws3");
    document.body.appendChild(button);

    button.click();
    // 重複登録していたら2回接続されるが、1回だけ
    expect(MockWebSocket.instances).toHaveLength(1);

    el.remove();
    button.remove();
  });

  it("event.targetがElementでない場合は何もしない", () => {
    registerAutoTrigger();

    // targetがnullのイベントを手動発火
    const event = new Event("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: null });
    document.dispatchEvent(event);

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("data-wstarget属性を持たない要素のクリックは無視する", () => {
    registerAutoTrigger();

    const button = document.createElement("button");
    document.body.appendChild(button);
    button.click();

    expect(MockWebSocket.instances).toHaveLength(0);
    button.remove();
  });

  it("ネストされた要素のクリックでも動作する", () => {
    registerAutoTrigger();

    const el = document.createElement("wcs-ws") as WcsWebSocket;
    el.setAttribute("url", "ws://localhost:8080");
    el.setAttribute("manual", "");
    el.setAttribute("id", "my-ws4");
    document.body.appendChild(el);

    const button = document.createElement("button");
    button.setAttribute("data-wstarget", "my-ws4");
    const span = document.createElement("span");
    span.textContent = "Connect";
    button.appendChild(span);
    document.body.appendChild(button);

    span.click();
    expect(MockWebSocket.instances).toHaveLength(1);

    el.remove();
    button.remove();
  });
});

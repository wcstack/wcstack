import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SseCore } from "../src/core/SseCore";

// EventSource モック（happy-dom には EventSource が無い）
class MockEventSource extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readyState = MockEventSource.CONNECTING;
  url: string;
  withCredentials: boolean;

  static instances: MockEventSource[] = [];
  static nextConstructError: Error | null = null;

  constructor(url: string, opts?: EventSourceInit) {
    super();
    if (MockEventSource.nextConstructError) {
      const err = MockEventSource.nextConstructError;
      MockEventSource.nextConstructError = null;
      throw err;
    }
    this.url = url;
    this.withCredentials = opts?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  close = vi.fn().mockImplementation(function (this: MockEventSource) {
    this.readyState = MockEventSource.CLOSED;
  });

  // --- テストヘルパー ---
  simulateOpen(): void {
    this.readyState = MockEventSource.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  simulateMessage(data: any, lastEventId = ""): void {
    this.dispatchEvent(new MessageEvent("message", { data, lastEventId }));
  }

  simulateNamedEvent(type: string, data: any, lastEventId = ""): void {
    this.dispatchEvent(new MessageEvent(type, { data, lastEventId }));
  }

  simulateError(readyState = MockEventSource.CONNECTING): void {
    this.readyState = readyState;
    this.dispatchEvent(new Event("error"));
  }

  static resetInstances(): void {
    MockEventSource.instances = [];
    MockEventSource.nextConstructError = null;
  }

  static get last(): MockEventSource {
    return MockEventSource.instances[MockEventSource.instances.length - 1];
  }
}

describe("SseCore", () => {
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    (globalThis as any).EventSource = MockEventSource;
    MockEventSource.resetInstances();
  });

  afterEach(() => {
    (globalThis as any).EventSource = originalEventSource;
  });

  describe("初期状態", () => {
    it("初期値が正しい", () => {
      const core = new SseCore();
      expect(core.message).toBeNull();
      expect(core.connected).toBe(false);
      expect(core.loading).toBe(false);
      expect(core.error).toBeNull();
      expect(core.readyState).toBe(MockEventSource.CLOSED);
    });

    it("wcBindable に message/connected/loading/error/readyState が宣言される", () => {
      const names = SseCore.wcBindable.properties.map(p => p.name);
      expect(names).toEqual(["message", "connected", "loading", "error", "readyState"]);
    });

    it("wcBindable の commands は connect/close のみ", () => {
      const names = SseCore.wcBindable.commands?.map(c => c.name);
      expect(names).toEqual(["connect", "close"]);
    });
  });

  describe("connect", () => {
    it("url が空なら例外を投げず error に流す（never-throw）", () => {
      const core = new SseCore();
      expect(() => core.connect("")).not.toThrow();
      expect(core.error).toBeInstanceOf(Error);
      expect((core.error as Error).message).toMatch(/url is required/);
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("EventSource を生成し loading=true・readyState=CONNECTING になる", () => {
      const core = new SseCore();
      core.connect("/feed");
      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.last.url).toBe("/feed");
      expect(core.loading).toBe(true);
      expect(core.readyState).toBe(MockEventSource.CONNECTING);
    });

    it("withCredentials を渡せる", () => {
      const core = new SseCore();
      core.connect("/feed", { withCredentials: true });
      expect(MockEventSource.last.withCredentials).toBe(true);
    });

    it("withCredentials 既定は false", () => {
      const core = new SseCore();
      core.connect("/feed");
      expect(MockEventSource.last.withCredentials).toBe(false);
    });

    it("既存接続をクローズしてから再接続する", () => {
      const core = new SseCore();
      core.connect("/a");
      const first = MockEventSource.last;
      core.connect("/b");
      expect(first.close).toHaveBeenCalled();
      expect(MockEventSource.instances).toHaveLength(2);
      expect(MockEventSource.last.url).toBe("/b");
    });

    it("コンストラクタが例外を投げると error に集約し loading=false", () => {
      const core = new SseCore();
      MockEventSource.nextConstructError = new Error("boom");
      core.connect("/feed");
      expect(core.error).toBeInstanceOf(Error);
      expect(core.loading).toBe(false);
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("同一 url で接続中なら connect は no-op（upgrade 二重発火の吸収）", () => {
      const core = new SseCore();
      core.connect("/feed");
      const first = MockEventSource.last;
      core.connect("/feed");
      expect(MockEventSource.instances).toHaveLength(1);
      expect(first.close).not.toHaveBeenCalled();
    });

    it("OPEN 状態でも同一 url の再接続は no-op", () => {
      const core = new SseCore();
      core.connect("/feed");
      MockEventSource.last.simulateOpen();
      core.connect("/feed");
      expect(MockEventSource.instances).toHaveLength(1);
    });

    it("異なる url なら再接続する", () => {
      const core = new SseCore();
      core.connect("/a");
      core.connect("/b");
      expect(MockEventSource.instances).toHaveLength(2);
      expect(MockEventSource.last.url).toBe("/b");
    });

    it("CLOSED（恒久エラー後）は同一 url でも再接続する", () => {
      const core = new SseCore();
      core.connect("/feed");
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      core.connect("/feed");
      expect(MockEventSource.instances).toHaveLength(2);
    });
  });

  describe("same-value ガード（再接続ストーム抑制）", () => {
    it("再接続中の連続 CONNECTING エラーで connected/loading/readyState を再 dispatch しない", () => {
      const target = new EventTarget();
      const connSpy = vi.fn();
      const loadSpy = vi.fn();
      const stateSpy = vi.fn();
      target.addEventListener("wcs-sse:connected-changed", connSpy);
      target.addEventListener("wcs-sse:loading-changed", loadSpy);
      target.addEventListener("wcs-sse:readystate-changed", stateSpy);

      const core = new SseCore(target);
      core.connect("/feed");
      MockEventSource.last.simulateOpen();
      connSpy.mockClear();
      loadSpy.mockClear();
      stateSpy.mockClear();

      // ネイティブ再接続中は CONNECTING のまま error が連発する
      MockEventSource.last.simulateError(MockEventSource.CONNECTING);
      MockEventSource.last.simulateError(MockEventSource.CONNECTING);

      // 1 回目だけが状態変更（false/true/CONNECTING）、2 回目は同値で抑制
      expect(connSpy).toHaveBeenCalledTimes(1);
      expect(loadSpy).toHaveBeenCalledTimes(1);
      expect(stateSpy).toHaveBeenCalledTimes(1);
    });

    it("error は Event ごとに別物なので連続エラーでも毎回 dispatch する", () => {
      const target = new EventTarget();
      const errSpy = vi.fn();
      target.addEventListener("wcs-sse:error", errSpy);

      const core = new SseCore(target);
      core.connect("/feed");
      errSpy.mockClear();
      MockEventSource.last.simulateError(MockEventSource.CONNECTING);
      MockEventSource.last.simulateError(MockEventSource.CONNECTING);
      expect(errSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("open", () => {
    it("open で connected=true・loading=false・readyState=OPEN", () => {
      const core = new SseCore();
      core.connect("/feed");
      MockEventSource.last.simulateOpen();
      expect(core.connected).toBe(true);
      expect(core.loading).toBe(false);
      expect(core.readyState).toBe(MockEventSource.OPEN);
    });
  });

  describe("message", () => {
    it("JSON 文字列は自動パースされる", () => {
      const core = new SseCore();
      core.connect("/feed");
      MockEventSource.last.simulateMessage('{"a":1}');
      expect(core.message).toEqual({ event: "message", data: { a: 1 }, lastEventId: "" });
    });

    it("非 JSON 文字列はテキストのまま", () => {
      const core = new SseCore();
      core.connect("/feed");
      MockEventSource.last.simulateMessage("hello");
      expect(core.message?.data).toBe("hello");
    });

    it("lastEventId を保持する", () => {
      const core = new SseCore();
      core.connect("/feed");
      MockEventSource.last.simulateMessage("x", "42");
      expect(core.message?.lastEventId).toBe("42");
    });

    it("raw 指定時は JSON パースしない", () => {
      const core = new SseCore();
      core.connect("/feed", { raw: true });
      MockEventSource.last.simulateMessage('{"a":1}');
      expect(core.message?.data).toBe('{"a":1}');
    });

    it("文字列以外の data はそのまま渡す", () => {
      const core = new SseCore();
      core.connect("/feed");
      MockEventSource.last.simulateMessage(123);
      expect(core.message?.data).toBe(123);
    });
  });

  describe("名前付きイベント", () => {
    it("events で購読した名前付きイベントを message に集約する", () => {
      const core = new SseCore();
      core.connect("/feed", { events: ["price", "trade"] });
      MockEventSource.last.simulateNamedEvent("price", '{"v":10}');
      expect(core.message).toEqual({ event: "price", data: { v: 10 }, lastEventId: "" });
      MockEventSource.last.simulateNamedEvent("trade", "buy");
      expect(core.message).toEqual({ event: "trade", data: "buy", lastEventId: "" });
    });

    it("購読していない名前付きイベントは受信しない", () => {
      const core = new SseCore();
      core.connect("/feed", { events: ["price"] });
      MockEventSource.last.simulateNamedEvent("other", "x");
      expect(core.message).toBeNull();
    });
  });

  describe("error", () => {
    it("CONNECTING のエラーは再接続中とみなし loading を維持", () => {
      const core = new SseCore();
      core.connect("/feed");
      MockEventSource.last.simulateOpen();
      MockEventSource.last.simulateError(MockEventSource.CONNECTING);
      expect(core.error).toBeInstanceOf(Event);
      expect(core.connected).toBe(false);
      expect(core.loading).toBe(true);
      expect(core.readyState).toBe(MockEventSource.CONNECTING);
    });

    it("CLOSED のエラーは恒久エラーとみなし loading=false", () => {
      const core = new SseCore();
      core.connect("/feed");
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      expect(core.connected).toBe(false);
      expect(core.loading).toBe(false);
      expect(core.readyState).toBe(MockEventSource.CLOSED);
    });
  });

  describe("close", () => {
    it("close で EventSource を閉じ状態をリセットする", () => {
      const core = new SseCore();
      core.connect("/feed");
      MockEventSource.last.simulateOpen();
      const es = MockEventSource.last;
      core.close();
      expect(es.close).toHaveBeenCalled();
      expect(core.connected).toBe(false);
      expect(core.loading).toBe(false);
      expect(core.readyState).toBe(MockEventSource.CLOSED);
    });

    it("未接続で close してもエラーにならない", () => {
      const core = new SseCore();
      expect(() => core.close()).not.toThrow();
      expect(core.readyState).toBe(MockEventSource.CLOSED);
    });

    it("close 後は EventSource のイベントを受信しない", () => {
      const core = new SseCore();
      core.connect("/feed");
      const es = MockEventSource.last;
      core.close();
      es.simulateMessage("x");
      expect(core.message).toBeNull();
    });
  });

  describe("target 指定", () => {
    it("指定した target にイベントを dispatch する", () => {
      const target = new EventTarget();
      const handler = vi.fn();
      target.addEventListener("wcs-sse:message", handler);
      const core = new SseCore(target);
      core.connect("/feed");
      MockEventSource.last.simulateMessage("x");
      expect(handler).toHaveBeenCalled();
    });
  });

  describe("ライフサイクル（ready / observe / dispose）", () => {
    it("ready は解決済み Promise を返す", async () => {
      const core = new SseCore();
      await expect(core.ready).resolves.toBeUndefined();
    });

    it("observe() は ready を返し、冪等に再呼び出しできる", async () => {
      const core = new SseCore();
      await expect(core.observe()).resolves.toBeUndefined();
      await expect(core.observe()).resolves.toBeUndefined();
      // observe() は監視を張らない（command-driven）ため接続は生成されない。
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("dispose() は接続を閉じ状態をリセットする", () => {
      const core = new SseCore();
      core.connect("/feed");
      const es = MockEventSource.last;
      core.dispose();
      expect(es.close).toHaveBeenCalled();
      expect(core.connected).toBe(false);
      expect(core.loading).toBe(false);
      expect(core.readyState).toBe(MockEventSource.CLOSED);
    });

    // dispose() は通常 _closeInternal でリスナを解除するため、実機で stale イベントが
    // ハンドラに到達することはまず無い。しかし「dispose で _gen を進め、torn-down 要素へ
    // 書き込まない」という §3.4 のガード本体（各ハンドラ冒頭の世代チェック）を直接検証する。
    // ネイティブイベントが torn-down 後に遅延発火し、何らかの経路でハンドラが残っていた
    // 場合の防御を、ハンドラを直接呼び出して再現する。
    it("dispose 後の stale な open ハンドラは状態を書かない（_gen ガード）", () => {
      const core = new SseCore();
      core.connect("/feed");
      core.dispose();
      (core as any)._onOpen();
      expect(core.connected).toBe(false);
      expect(core.loading).toBe(false);
    });

    it("dispose 後の stale な message ハンドラは状態を書かない（_gen ガード）", () => {
      const core = new SseCore();
      core.connect("/feed");
      core.dispose();
      (core as any)._onMessage(new MessageEvent("message", { data: "late" }));
      expect(core.message).toBeNull();
    });

    it("dispose 後の stale な error ハンドラは状態を書かない（_gen ガード）", () => {
      const core = new SseCore();
      core.connect("/feed");
      core.dispose();
      (core as any)._onError(new Event("error"));
      expect(core.error).toBeNull();
    });

    it("dispose 後に observe → connect で監視を復活できる（boolean フラグでは救えない経路）", () => {
      const core = new SseCore();
      core.connect("/feed");
      core.dispose();
      // 復活：新しい世代で接続し直すと open が再び反映される。
      core.observe();
      core.connect("/feed");
      MockEventSource.last.simulateOpen();
      expect(core.connected).toBe(true);
    });
  });
});

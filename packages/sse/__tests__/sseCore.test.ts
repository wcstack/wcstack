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

    it("wcBindable に message/connected/loading/error/errorInfo/readyState が宣言される", () => {
      const names = SseCore.wcBindable.properties.map(p => p.name);
      expect(names).toEqual(["message", "connected", "loading", "error", "errorInfo", "readyState"]);
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

  describe("errorInfo taxonomy (Phase 6)", () => {
    it("初期状態の errorInfo は null", () => {
      expect(new SseCore().errorInfo).toBeNull();
    });

    it("errorInfo は wcBindable property(error の直後)として宣言される", () => {
      const names = SseCore.wcBindable.properties.map((p) => p.name);
      expect(names).toContain("errorInfo");
      expect(names.indexOf("errorInfo")).toBe(names.indexOf("error") + 1);
    });

    it("url 未指定 → invalid-argument / start / recoverable=false（error shape 不変）", () => {
      const core = new SseCore();
      core.connect("");
      expect(core.errorInfo).toEqual({
        code: "invalid-argument", phase: "start", recoverable: false, message: "url is required.",
      });
      // 公開 error shape は不変（Error のまま）。
      expect(core.error).toBeInstanceOf(Error);
      expect((core.error as Error).message).toBe("url is required.");
    });

    it("構築失敗 → connection-error / start / recoverable=false（stream 未確立）", () => {
      const core = new SseCore();
      MockEventSource.nextConstructError = new Error("bad url");
      core.connect("/feed");
      expect(core.errorInfo).toEqual({
        code: "connection-error", phase: "start", recoverable: false, message: "bad url",
      });
      // 公開 error shape は不変（構築時 throw の Error）。
      expect(core.error).toBeInstanceOf(Error);
    });

    it("トランジェント切断(CONNECTING) → connection-error / execute / recoverable=true", () => {
      const core = new SseCore();
      core.connect("/feed");
      MockEventSource.last.simulateOpen();
      MockEventSource.last.simulateError(MockEventSource.CONNECTING);
      // Event は message を持たないため安定 fallback。
      expect(core.errorInfo).toEqual({
        code: "connection-error", phase: "execute", recoverable: true, message: "SSE connection error",
      });
      // 公開 error shape は生の Event のまま。
      expect(core.error).toBeInstanceOf(Event);
    });

    it("恒久切断(CLOSED) → connection-error / execute / recoverable=false", () => {
      const core = new SseCore();
      core.connect("/feed");
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      expect(core.errorInfo).toEqual({
        code: "connection-error", phase: "execute", recoverable: false, message: "SSE connection error",
      });
      expect(core.error).toBeInstanceOf(Event);
    });

    it("トランジェント切断後にネイティブ再接続が成功すると error と共に errorInfo も null に戻る", () => {
      const core = new SseCore();
      core.connect("/feed");
      MockEventSource.last.simulateOpen();
      MockEventSource.last.simulateError(MockEventSource.CONNECTING);
      expect(core.errorInfo).not.toBeNull();
      // 同一インスタンスが open を再発火 → _onOpen の _setError(null) で clear。
      MockEventSource.last.simulateOpen();
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("errorInfo は error と同期して遷移し、error より前に error-info-changed が流れる", () => {
      const target = new EventTarget();
      const order: string[] = [];
      target.addEventListener("wcs-sse:error-info-changed", () => order.push("errorInfo"));
      target.addEventListener("wcs-sse:error", () => order.push("error"));
      const core = new SseCore(target);
      core.connect("/feed");
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      expect(order).toEqual(["errorInfo", "error"]);
      expect(core.errorInfo).not.toBeNull();
    });
  });

  // 閉じられずに死んだ接続に EventSource は気づかない（docs/seam-apps.md、shift-desk）
  describe("staleAfter: 何も届かない開いたストリームを開き直す", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("最後のイベントから staleAfter ms 何も届かなければ、閉じて同じ url で開き直し、理由を error に残す", () => {
      const core = new SseCore();
      const connected: boolean[] = [];
      core.addEventListener("wcs-sse:connected-changed", (e) => connected.push((e as CustomEvent).detail));
      core.connect("/feed?since=5", { staleAfter: 1000 });
      const first = MockEventSource.last;
      first.simulateOpen();
      vi.advanceTimersByTime(600);
      first.simulateMessage("a");
      vi.advanceTimersByTime(900);
      expect(MockEventSource.instances).toHaveLength(1);
      vi.advanceTimersByTime(100);
      expect(first.close).toHaveBeenCalled();
      expect(MockEventSource.instances).toHaveLength(2);
      expect(MockEventSource.last.url).toBe("/feed?since=5");
      expect(core.connected).toBe(false);
      expect(core.loading).toBe(true);
      expect((core.error as Error).message).toBe("No event for 1000 ms: the stream is treated as lost and reopened.");
      expect(core.errorInfo?.recoverable).toBe(true);
      // 古いストリームのイベントは捨てる
      first.simulateMessage("late");
      expect(core.message).toEqual({ event: "message", data: "a", lastEventId: "" });
      MockEventSource.last.simulateOpen();
      expect(core.connected).toBe(true);
      expect(core.error).toBeNull();
      expect(connected).toEqual([true, false, true]);
    });

    it("イベントが続く間は開き直さない（タイマーは 1 本、満了のたびに残りで張り直す）", () => {
      const core = new SseCore();
      core.connect("/feed", { staleAfter: 1000 });
      MockEventSource.last.simulateOpen();
      for (let i = 0; i < 20; i++) {
        vi.advanceTimersByTime(500);
        MockEventSource.last.simulateMessage(String(i));
      }
      expect(MockEventSource.instances).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(1);
    });

    it("staleAfter が無い・0 なら見張らない", () => {
      for (const options of [{}, { staleAfter: 0 }, { staleAfter: -5 }]) {
        MockEventSource.resetInstances();
        const core = new SseCore();
        core.connect("/feed", options);
        MockEventSource.last.simulateOpen();
        vi.advanceTimersByTime(60_000);
        expect(MockEventSource.instances).toHaveLength(1);
        expect(core.connected).toBe(true);
        core.close();
      }
    });

    it("ネイティブの再接続中は見張らず、次の open から数え直す", () => {
      const core = new SseCore();
      core.connect("/feed", { staleAfter: 1000 });
      const es = MockEventSource.last;
      es.simulateOpen();
      vi.advanceTimersByTime(500);
      es.simulateError(MockEventSource.CONNECTING);
      vi.advanceTimersByTime(2000);
      expect(MockEventSource.instances).toHaveLength(1);
      es.simulateOpen();
      vi.advanceTimersByTime(999);
      expect(MockEventSource.instances).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(MockEventSource.instances).toHaveLength(2);
    });

    it("close() と dispose() は見張りを止める", () => {
      const core = new SseCore();
      core.connect("/feed", { staleAfter: 1000 });
      MockEventSource.last.simulateOpen();
      core.close();
      expect(vi.getTimerCount()).toBe(0);
      core.connect("/feed", { staleAfter: 1000 });
      MockEventSource.last.simulateOpen();
      core.dispose();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(5000);
      expect(MockEventSource.instances).toHaveLength(2);
    });

    it("開き直しの EventSource の生成に失敗したら、その error が残る", () => {
      const core = new SseCore();
      core.connect("/feed", { staleAfter: 1000 });
      MockEventSource.last.simulateOpen();
      MockEventSource.nextConstructError = new Error("blocked");
      vi.advanceTimersByTime(1000);
      expect((core.error as Error).message).toBe("blocked");
      expect(core.errorInfo?.recoverable).toBe(false);
    });
  });

  // ブラウザが諦めたストリーム（HTTP のエラー: 再起動中の 502、期限切れのトークンの 401）を
  // EventSource は再試行しない。継ぎ目アプリ 3 本が同じタイマーを手で書いた（state-collab-board・
  // shift-desk・family-ledger）。<wcs-ws> と同じ名前・同じ意味の opt-in。
  describe("autoReconnect: ブラウザが諦めたストリームを開き直す", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("恒久エラー(CLOSED)の後、reconnectInterval ms 待って同じ url で開き直す。待つ間は諦めた状態のまま", () => {
      const core = new SseCore();
      core.connect("/feed", { autoReconnect: true, reconnectInterval: 2000 });
      const first = MockEventSource.last;
      first.simulateOpen();
      first.simulateError(MockEventSource.CLOSED);
      const gaveUp = core.error;

      // 待つ間: ブラウザが諦めたときの状態（error / errorInfo はその失敗）
      expect(core.connected).toBe(false);
      expect(core.loading).toBe(false);
      expect(core.readyState).toBe(MockEventSource.CLOSED);
      expect(gaveUp).toBeInstanceOf(Event);
      expect(core.errorInfo).toEqual({
        code: "connection-error", phase: "execute", recoverable: false, message: "SSE connection error",
      });
      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersByTime(1999);
      expect(MockEventSource.instances).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(MockEventSource.instances).toHaveLength(2);
      expect(MockEventSource.last.url).toBe("/feed");
      // 試行: 接続中になり、error は消える（connect() と同じ）
      expect(core.loading).toBe(true);
      expect(core.readyState).toBe(MockEventSource.CONNECTING);
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();

      MockEventSource.last.simulateOpen();
      expect(core.connected).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("既定の間隔は 3000 ms で、一度も開かなかったストリーム（読み込み時の 502）も開き直す", () => {
      const core = new SseCore();
      core.connect("/feed", { autoReconnect: true });
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      vi.advanceTimersByTime(2999);
      expect(MockEventSource.instances).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(MockEventSource.instances).toHaveLength(2);
    });

    it("autoReconnect が無ければ（既定）開き直さない", () => {
      for (const options of [{}, { autoReconnect: false }]) {
        MockEventSource.resetInstances();
        const core = new SseCore();
        core.connect("/feed", options);
        MockEventSource.last.simulateError(MockEventSource.CLOSED);
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(60_000);
        expect(MockEventSource.instances).toHaveLength(1);
        expect(core.readyState).toBe(MockEventSource.CLOSED);
      }
    });

    it("一過性の切断(CONNECTING)はブラウザの再接続に任せ、開き直さない", () => {
      const core = new SseCore();
      core.connect("/feed", { autoReconnect: true, reconnectInterval: 100 });
      const es = MockEventSource.last;
      es.simulateOpen();
      es.simulateError(MockEventSource.CONNECTING);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10_000);
      expect(MockEventSource.instances).toHaveLength(1);
      expect(es.close).not.toHaveBeenCalled();
      expect(core.loading).toBe(true);
    });

    it("maxReconnects 回の試行で止まり、最後の error が残る", () => {
      const core = new SseCore();
      core.connect("/feed", { autoReconnect: true, reconnectInterval: 100, maxReconnects: 2 });
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      vi.advanceTimersByTime(100);
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      vi.advanceTimersByTime(100);
      expect(MockEventSource.instances).toHaveLength(3);
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      const last = core.error;
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10_000);
      expect(MockEventSource.instances).toHaveLength(3);
      expect(core.error).toBe(last);
      expect(core.errorInfo?.recoverable).toBe(false);
      expect(core.readyState).toBe(MockEventSource.CLOSED);
      expect(core.loading).toBe(false);
    });

    it("maxReconnects が 0 なら開き直さない", () => {
      const core = new SseCore();
      core.connect("/feed", { autoReconnect: true, maxReconnects: 0 });
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("開いたら回数は数え直す", () => {
      const core = new SseCore();
      core.connect("/feed", { autoReconnect: true, reconnectInterval: 100, maxReconnects: 1 });
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      vi.advanceTimersByTime(100);
      MockEventSource.last.simulateOpen();
      // 開いた後に諦めたら、また 1 回開き直せる
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      vi.advanceTimersByTime(100);
      expect(MockEventSource.instances).toHaveLength(3);
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      vi.advanceTimersByTime(10_000);
      expect(MockEventSource.instances).toHaveLength(3);
    });

    it("close() は待っている開き直しを止める", () => {
      const core = new SseCore();
      core.connect("/feed", { autoReconnect: true, reconnectInterval: 100 });
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      core.close();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10_000);
      expect(MockEventSource.instances).toHaveLength(1);
    });

    it("dispose() は待っている開き直しを止める", () => {
      const core = new SseCore();
      core.connect("/feed", { autoReconnect: true, reconnectInterval: 100 });
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      core.dispose();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10_000);
      expect(MockEventSource.instances).toHaveLength(1);
    });

    it("connect() は待っている開き直しを外し（その場で開く）、回数を数え直す", () => {
      const core = new SseCore();
      core.connect("/feed", { autoReconnect: true, reconnectInterval: 100, maxReconnects: 1 });
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      vi.advanceTimersByTime(100);
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      // 回数は尽きた。connect() で数え直す
      expect(vi.getTimerCount()).toBe(0);
      core.connect("/feed", { autoReconnect: true, reconnectInterval: 100, maxReconnects: 1 });
      expect(MockEventSource.instances).toHaveLength(3);
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      expect(vi.getTimerCount()).toBe(1);
      // 待っている間の connect() はそのタイマーを外す: 開くのは 1 本だけ
      core.connect("/feed", { autoReconnect: true, reconnectInterval: 100, maxReconnects: 1 });
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10_000);
      expect(MockEventSource.instances).toHaveLength(4);
    });

    it("reconnectUrl があれば、試行のときに読んだ url で開く", () => {
      let url = "/feed?token=old";
      const core = new SseCore();
      core.connect(url, { autoReconnect: true, reconnectInterval: 100, reconnectUrl: () => url });
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      url = "/feed?token=new";
      vi.advanceTimersByTime(100);
      expect(MockEventSource.last.url).toBe("/feed?token=new");
      // 開いているストリームの url として扱う（同じ url の connect() は no-op）
      core.connect("/feed?token=new");
      expect(MockEventSource.instances).toHaveLength(2);
    });

    it("試行のときの url が空なら何もしない（数えず、次も予約しない）", () => {
      let url = "/feed";
      const core = new SseCore();
      core.connect(url, { autoReconnect: true, reconnectInterval: 100, reconnectUrl: () => url });
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      const gaveUp = core.error;
      url = "";
      vi.advanceTimersByTime(100);
      expect(MockEventSource.instances).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(core.error).toBe(gaveUp);
      expect(core.readyState).toBe(MockEventSource.CLOSED);
    });

    it("試行の EventSource の生成に失敗したら、その error が残り、次は予約しない", () => {
      const core = new SseCore();
      core.connect("/feed", { autoReconnect: true, reconnectInterval: 100 });
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      MockEventSource.nextConstructError = new Error("bad url");
      vi.advanceTimersByTime(100);
      expect((core.error as Error).message).toBe("bad url");
      expect(core.errorInfo).toEqual({
        code: "connection-error", phase: "start", recoverable: false, message: "bad url",
      });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("世代が進んだ後に発火したタイマーは何もしない（_gen ガード）", () => {
      const core = new SseCore();
      core.connect("/feed", { autoReconnect: true, reconnectInterval: 100 });
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      // dispose / connect は _closeInternal でタイマーを外す。外し損ねた場合の裏打ちを直接確かめる
      (core as any)._gen++;
      vi.advanceTimersByTime(100);
      expect(MockEventSource.instances).toHaveLength(1);
    });

    it("恒久エラーの通知の中で close() されたら、開き直しを予約しない（再入）", () => {
      const target = new EventTarget();
      const core = new SseCore(target);
      target.addEventListener("wcs-sse:readystate-changed", (e) => {
        if ((e as CustomEvent).detail === MockEventSource.CLOSED) core.close();
      });
      core.connect("/feed", { autoReconnect: true, reconnectInterval: 100 });
      MockEventSource.last.simulateOpen();
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10_000);
      expect(MockEventSource.instances).toHaveLength(1);
    });

    it("恒久エラーの通知の中で connect() されたら、その新しいストリームを壊さず、開き直しも予約しない（再入）", () => {
      const target = new EventTarget();
      const core = new SseCore(target);
      let reentered = false;
      target.addEventListener("wcs-sse:connected-changed", (e) => {
        if ((e as CustomEvent).detail === false && !reentered) {
          reentered = true;
          core.connect("/other", { autoReconnect: true, reconnectInterval: 100 });
        }
      });
      core.connect("/feed", { autoReconnect: true, reconnectInterval: 100 });
      MockEventSource.last.simulateOpen();
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      const other = MockEventSource.last;
      expect(other.url).toBe("/other");
      expect(other.close).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      // 再入した接続の状態を巻き戻さない（接続中のまま）
      expect(core.loading).toBe(true);
      expect(core.readyState).toBe(MockEventSource.CONNECTING);
      // 新しいストリームは生きている（参照を失っていない）
      other.simulateOpen();
      expect(core.connected).toBe(true);
      other.simulateMessage("from-other");
      expect(core.message?.data).toBe("from-other");
      // 閉じられる
      core.close();
      expect(other.close).toHaveBeenCalled();
    });

    it("恒久エラーの loading の通知の中で close() されたら、開き直しを予約しない（再入）", () => {
      const target = new EventTarget();
      const core = new SseCore(target);
      target.addEventListener("wcs-sse:loading-changed", (e) => {
        if ((e as CustomEvent).detail === false) core.close();
      });
      // 一度も開かずに諦める（loading が true → false になる）
      core.connect("/feed", { autoReconnect: true, reconnectInterval: 100 });
      const es = MockEventSource.last;
      es.simulateError(MockEventSource.CLOSED);
      expect(es.close).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10_000);
      expect(MockEventSource.instances).toHaveLength(1);
    });

    it("stale-after と重ならない: 諦めたら見張りを外し、タイマーは常に 1 本まで", () => {
      const core = new SseCore();
      core.connect("/feed", { autoReconnect: true, reconnectInterval: 500, staleAfter: 1000 });
      MockEventSource.last.simulateOpen();
      expect(vi.getTimerCount()).toBe(1); // 見張り
      // 黙ったストリーム: 見張りがその場で開き直す（auto-reconnect の回数・間隔とは別）
      vi.advanceTimersByTime(1000);
      expect(MockEventSource.instances).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(0);
      // 開き直したストリームをブラウザが諦めた: auto-reconnect の開き直しだけが待つ
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(500);
      expect(MockEventSource.instances).toHaveLength(3);
      expect(vi.getTimerCount()).toBe(0);
      MockEventSource.last.simulateOpen();
      expect(vi.getTimerCount()).toBe(1); // 見張りが戻る
    });

    it("開いた後に諦めたストリームの見張りは外す（auto-reconnect が無くても残らない）", () => {
      const core = new SseCore();
      core.connect("/feed", { staleAfter: 1000 });
      MockEventSource.last.simulateOpen();
      expect(vi.getTimerCount()).toBe(1);
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

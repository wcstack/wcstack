import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FetchCore } from "../src/core/FetchCore";

function createMockResponse(body: any, options: { status?: number; ok?: boolean; contentType?: string } = {}): Response {
  const { status = 200, ok = true, contentType = "application/json" } = options;
  const headers = new Headers({ "Content-Type": contentType });
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    headers,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe("FetchCore", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("EventTargetを継承している", () => {
    const core = new FetchCore();
    expect(core).toBeInstanceOf(EventTarget);
  });

  it("wcBindableプロパティが正しく定義されている", () => {
    expect(FetchCore.wcBindable.protocol).toBe("wc-bindable");
    expect(FetchCore.wcBindable.version).toBe(1);
    expect(FetchCore.wcBindable.properties).toHaveLength(4);
    expect(FetchCore.wcBindable.properties[0].name).toBe("value");
    expect(FetchCore.wcBindable.properties[1].name).toBe("loading");
    expect(FetchCore.wcBindable.properties[2].name).toBe("error");
    expect(FetchCore.wcBindable.properties[3].name).toBe("status");
  });

  it("初期状態が正しい", () => {
    const core = new FetchCore();
    expect(core.value).toBeNull();
    expect(core.loading).toBe(false);
    expect(core.error).toBeNull();
    expect(core.status).toBe(0);
  });

  it("target未指定時はイベントが自身にディスパッチされる", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ data: "test" }));

    const core = new FetchCore();
    const events: string[] = [];
    core.addEventListener("wcs-fetch:loading-changed", () => events.push("loading"));
    core.addEventListener("wcs-fetch:response", () => events.push("response"));

    await core.fetch("/api/test");

    expect(events).toEqual(["loading", "response", "loading"]);
    expect(core.value).toEqual({ data: "test" });
  });

  it("target指定時はイベントがtargetにディスパッチされる", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ data: "test" }));

    const target = new EventTarget();
    const core = new FetchCore(target);
    const coreEvents: string[] = [];
    const targetEvents: string[] = [];

    core.addEventListener("wcs-fetch:response", () => coreEvents.push("response"));
    target.addEventListener("wcs-fetch:response", () => targetEvents.push("response"));

    await core.fetch("/api/test");

    expect(coreEvents).toEqual([]);
    expect(targetEvents).toEqual(["response"]);
  });

  it("GETリクエストでJSONレスポンスを取得できる", async () => {
    const mockData = { users: [{ id: 1 }] };
    fetchSpy.mockResolvedValueOnce(createMockResponse(mockData));

    const core = new FetchCore();
    const result = await core.fetch("/api/users");

    expect(result).toEqual(mockData);
    expect(core.value).toEqual(mockData);
    expect(core.status).toBe(200);
    expect(core.loading).toBe(false);
    expect(core.error).toBeNull();
  });

  it("テキストレスポンスを取得できる", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse("hello", { contentType: "text/plain" }));

    const core = new FetchCore();
    const result = await core.fetch("/api/text");

    expect(result).toBe("hello");
  });

  it("forceText指定時はContent-Typeに関係なくテキストとして処理する", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse("<p>html</p>", { contentType: "text/html" }));

    const core = new FetchCore();
    const result = await core.fetch("/api/html", { forceText: true });

    expect(result).toBe("<p>html</p>");
  });

  it("POSTリクエストでbodyを送信できる", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ created: true }));

    const core = new FetchCore();
    await core.fetch("/api/users", {
      method: "POST",
      body: '{"name":"test"}',
      contentType: "application/json",
    });

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBe('{"name":"test"}');
  });

  it("GETリクエストではbodyを送信しない", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const core = new FetchCore();
    await core.fetch("/api/test", { method: "GET", body: "ignored" });

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).body).toBeUndefined();
  });

  it("HTTPエラーレスポンスを処理できる", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse("Not Found", { status: 404, ok: false }));

    const core = new FetchCore();
    const errors: any[] = [];
    core.addEventListener("wcs-fetch:error", (e: Event) => {
      errors.push((e as CustomEvent).detail);
    });

    const result = await core.fetch("/api/missing");

    expect(result).toBeNull();
    expect(core.status).toBe(404);
    expect(errors).toHaveLength(1);
    expect(errors[0].status).toBe(404);
  });

  it("ネットワークエラーを処理できる", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const core = new FetchCore();
    const result = await core.fetch("/api/error");

    expect(result).toBeNull();
    expect(core.error).toBeInstanceOf(TypeError);
    expect(core.loading).toBe(false);
  });

  it("url未指定時にエラーをスローする", async () => {
    const core = new FetchCore();
    await expect(core.fetch("")).rejects.toThrow("[@wcstack/fetch] url attribute is required.");
  });

  it("abort()で進行中のリクエストをキャンセルできる", async () => {
    fetchSpy.mockImplementationOnce((_url, init) => {
      return new Promise((_resolve, reject) => {
        (init as RequestInit).signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const core = new FetchCore();
    const fetchPromise = core.fetch("/api/slow");
    core.abort();

    const result = await fetchPromise;
    expect(result).toBeNull();
    expect(core.loading).toBe(false);
  });

  it("2回目のfetch()が1回目を自動キャンセルする", async () => {
    let callCount = 0;
    fetchSpy.mockImplementation((_url, init) => {
      callCount++;
      const currentCall = callCount;
      return new Promise((resolve, reject) => {
        (init as RequestInit).signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
        if (currentCall === 2) {
          resolve(createMockResponse({ call: 2 }));
        }
      });
    });

    const core = new FetchCore();
    const promise1 = core.fetch("/api/test");
    const promise2 = core.fetch("/api/test");

    const [result1, result2] = await Promise.all([promise1, promise2]);
    expect(result1).toBeNull();
    expect(result2).toEqual({ call: 2 });
  });

  it("Content-Typeヘッダが明示的に設定されている場合は上書きしない", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const core = new FetchCore();
    await core.fetch("/api/test", {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: "data",
      contentType: "application/json",
    });

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({ "Content-Type": "text/xml" })
    );
  });

  it("DOM非依存でNode.jsランタイムでも動作可能", () => {
    // FetchCoreはEventTargetのみに依存し、HTMLElementを必要としない
    const core = new FetchCore();
    expect(core).toBeInstanceOf(EventTarget);
    expect(core).not.toBeInstanceOf(HTMLElement);
  });
});

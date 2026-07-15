import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FetchCore } from "../src/core/FetchCore";
import { WCS_FETCH_ERROR_CODE } from "../src/core/platformCapability";

function jsonResponse(body: any, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe("FetchCore Phase 6 — supported / platformAssessment", () => {
  it("fetch / AbortController が揃えば supported=true・readiness=ready", () => {
    const core = new FetchCore();
    expect(core.supported).toBe(true);
    const a = core.platformAssessment;
    expect(a.readiness).toBe("ready");
    expect(a.availability.get("web.fetch")).toBe("available");
    expect(a.availability.get("web.abort-controller")).toBe("available");
    expect(a.activity).toBe("inactive");
    expect(core.errorInfo).toBeNull();
  });
});

describe("FetchCore Phase 6 — capability matrix", () => {
  const origFetch = globalThis.fetch;
  const origAC = globalThis.AbortController;

  afterEach(() => {
    (globalThis as { fetch?: unknown }).fetch = origFetch;
    (globalThis as { AbortController?: unknown }).AbortController = origAC;
  });

  it("web.fetch 欠如(required)は capability-missing で開始せず fetch を呼ばない", async () => {
    let called = false;
    (globalThis as { fetch?: unknown }).fetch = undefined; // web.fetch 欠如
    const core = new FetchCore();
    expect(core.supported).toBe(false);
    expect(core.platformAssessment.readiness).toBe("idle");
    expect(core.platformAssessment.availability.get("web.fetch")).toBe("missing");

    const result = await core.fetch("/api/x");
    expect(result).toBeNull();
    expect(called).toBe(false);
    expect(core.error).toEqual({ message: 'Required capability "web.fetch" is unavailable.' });
    expect(core.errorInfo).toEqual({
      code: WCS_FETCH_ERROR_CODE.CapabilityMissing,
      phase: "start",
      recoverable: false,
      capabilityId: "web.fetch",
      message: 'Required capability "web.fetch" is unavailable.',
    });
    expect(core.loading).toBe(false); // 開始していない
  });

  it("web.abort-controller 欠如(optional)は degraded で fetch を signal なしに実行する", async () => {
    const calls: RequestInit[] = [];
    (globalThis as { fetch?: unknown }).fetch = ((_url: string, init: RequestInit) => {
      calls.push(init);
      return Promise.resolve(jsonResponse({ ok: true }));
    }) as typeof fetch;
    (globalThis as { AbortController?: unknown }).AbortController = undefined; // optional 欠如

    const core = new FetchCore();
    expect(core.supported).toBe(true); // required は揃っている
    expect(core.platformAssessment.readiness).toBe("degraded");

    const result = await core.fetch("/api/x");
    expect(result).toEqual({ ok: true });
    // signal なしで呼ばれる(AbortController 不在でも throw しない)
    expect(calls[0].signal).toBeUndefined();
    expect(core.errorInfo).toBeNull();
  });
});

describe("FetchCore Phase 6 — error taxonomy (errorInfo, existing error shape unchanged)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, "fetch"); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it("空 url は invalid-argument(error property は既存 shape のまま)", async () => {
    const core = new FetchCore();
    await core.fetch("");
    expect(core.error).toEqual({ message: "url attribute is required." }); // 既存 shape 不変
    expect(core.errorInfo).toEqual({
      code: WCS_FETCH_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false,
      message: "url attribute is required.",
    });
  });

  it("HTTP エラーは http-error", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse("Not Found", 404));
    const core = new FetchCore();
    await core.fetch("/api/missing");
    expect(core.errorInfo?.code).toBe(WCS_FETCH_ERROR_CODE.HttpError);
    expect(core.errorInfo?.phase).toBe("execute");
  });

  it("ネットワークエラーは network", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const core = new FetchCore();
    await core.fetch("/api/x");
    expect(core.errorInfo?.code).toBe(WCS_FETCH_ERROR_CODE.Network);
    expect(core.errorInfo?.message).toBe("Failed to fetch");
  });

  it("message を持たないネットワークエラーは既定文言にフォールバックする", async () => {
    fetchSpy.mockRejectedValueOnce({ name: "WeirdError" }); // message なし・非 AbortError
    const core = new FetchCore();
    await core.fetch("/api/x");
    expect(core.errorInfo).toEqual({ code: WCS_FETCH_ERROR_CODE.Network, phase: "execute", recoverable: true, message: "Network request failed." });
  });

  it("falsy な rejection(null)でも error/errorInfo が同期し error イベントが発火する", async () => {
    fetchSpy.mockRejectedValueOnce(null); // 病的な fetch: null を reject
    const core = new FetchCore();
    const errors: unknown[] = [];
    core.addEventListener("wcs-fetch:error", (e) => errors.push((e as CustomEvent).detail));
    await core.fetch("/api/x");
    // error は同値ガードに潰されず非 null envelope、イベントも 1 回発火
    expect(core.error).toEqual({ message: "Network request failed." });
    expect(errors).toHaveLength(1);
    expect(core.errorInfo?.code).toBe(WCS_FETCH_ERROR_CODE.Network);
  });

  it("成功で errorInfo はクリアされる", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("boom"));
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const core = new FetchCore();
    await core.fetch("/api/x");
    expect(core.errorInfo).not.toBeNull();
    await core.fetch("/api/y");
    expect(core.errorInfo).toBeNull();
  });

  it("timeout は timeout code", async () => {
    vi.useFakeTimers();
    try {
      fetchSpy.mockImplementationOnce((_u, init) => new Promise((_r, reject) => {
        (init as RequestInit).signal?.addEventListener("abort", () => reject(new DOMException("a", "AbortError")));
      }));
      const core = new FetchCore();
      const p = core.fetch("/api/slow", { timeout: 50 });
      await vi.advanceTimersByTimeAsync(50);
      await p;
      expect(core.errorInfo).toEqual({
        code: WCS_FETCH_ERROR_CODE.Timeout, phase: "execute", recoverable: true,
        message: "Request timed out after 50ms.",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

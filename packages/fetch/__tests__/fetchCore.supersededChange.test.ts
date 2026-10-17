import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FetchCore } from "../src/core/FetchCore";

/**
 * 実行中の書き込みの要求（GET / HEAD / OPTIONS 以外）を新しい要求が中断したら、それを名指して警告する
 * （docs/mistake-catalogue.md、"fetch-superseded-mutation"）。中断は設計どおり（latest）で、読みの中断は
 * 何も失わないので黙ったまま。
 */

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** A response that settles only when aborted. */
function pending(_url: unknown, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

describe("FetchCore — 中断された書き込みの要求", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  const superseded = () => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("[wcs/fetch-request-superseded]"));

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    warn.mockRestore();
  });

  it("実行中の POST を新しい要求が中断したら、メソッドと URL を名指して警告すること", async () => {
    fetchSpy.mockImplementationOnce(pending).mockResolvedValueOnce(jsonResponse({ ok: 2 }));
    const core = new FetchCore();
    const first = core.fetch("/api/save", { method: "post", body: "{}" });
    await core.fetch("/api/save", { method: "POST", body: "{}" });
    await first;
    expect(superseded()).toHaveLength(1);
    expect(superseded()[0]).toContain('A POST request to "/api/save" was still in flight');
  });

  it("実行中の GET を中断しても警告しないこと（読みの中断は何も失わない）", async () => {
    fetchSpy.mockImplementationOnce(pending).mockResolvedValueOnce(jsonResponse({ ok: 2 }));
    const core = new FetchCore();
    const first = core.fetch("/api/items");
    await core.fetch("/api/items?page=2");
    await first;
    expect(superseded()).toEqual([]);
  });

  it("終わった POST の後の要求は警告しないこと", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: 1 })).mockResolvedValueOnce(jsonResponse({ ok: 2 }));
    const core = new FetchCore();
    await core.fetch("/api/save", { method: "POST", body: "{}" });
    await core.fetch("/api/save", { method: "POST", body: "{}" });
    expect(superseded()).toEqual([]);
  });
});

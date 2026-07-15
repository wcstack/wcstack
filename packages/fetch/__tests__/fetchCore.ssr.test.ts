import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * Phase 6 完了条件(07-browser-capability-variance.md §検証条件):
 * 「SSR で全対象 package を import でき、browser global 不在で module evaluation が
 * 失敗しない」。capability probe は module 評価時でなく利用直前に行うため、
 * fetch / AbortController / isSecureContext が無くても import・construct・assessment が
 * 例外を投げない。
 */
describe("FetchCore SSR import safety", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { fetch: g.fetch, AbortController: g.AbortController, isSecureContext: g.isSecureContext };

  afterEach(() => {
    g.fetch = saved.fetch;
    g.AbortController = saved.AbortController;
    g.isSecureContext = saved.isSecureContext;
    vi.resetModules();
  });

  it("browser global 不在でも module 評価・construct・assessment が失敗しない", async () => {
    vi.resetModules();
    g.fetch = undefined;
    g.AbortController = undefined;
    g.isSecureContext = undefined;

    // module 評価(import)が browser global を必須参照しない。
    const mod = await import("../src/core/FetchCore");
    const capMod = await import("../src/core/platformCapability");

    let core: InstanceType<typeof mod.FetchCore> | undefined;
    expect(() => { core = new mod.FetchCore(); }).not.toThrow();

    // assessment は global 不在を安全に "missing" として報告する(throw しない)。
    expect(() => core!.platformAssessment).not.toThrow();
    expect(core!.supported).toBe(false);
    expect(core!.platformAssessment.readiness).toBe("idle");
    expect(core!.ready).toBeInstanceOf(Promise);

    // registry の probe も直接呼んで throw しないこと。
    expect(capMod.FETCH_CAPABILITIES.get("web.fetch")!.probe()).toBe(false);
    expect(capMod.FETCH_CAPABILITIES.get("web.abort-controller")!.probe()).toBe(false);
  });
});

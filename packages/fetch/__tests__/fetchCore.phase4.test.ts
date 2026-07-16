import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FetchCore } from "../src/core/FetchCore";

/**
 * Phase 4 (09-remediation-design.md §5 / §10.1 論点4) の fetch `latest` PoC 固有
 * 挙動: timeout 終端・terminal CAS による後着 drop・body-read 中 supersede/dispose の
 * stale-write 遮断。既存の latest supersede / abort / staleness 契約は
 * fetchCore.test.ts が担保する。
 */

function jsonResponse(body: any, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe("FetchCore Phase 4 — timeout terminal", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  it("timeout 経過で TimeoutError を error に流し value/status をリセットする", async () => {
    // 応答は abort でのみ reject する（=時間内に完了しない）
    fetchSpy.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      (init as RequestInit).signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    }));

    const core = new FetchCore();
    const errors: any[] = [];
    core.addEventListener("wcs-fetch:error", (e: Event) => errors.push((e as CustomEvent).detail));
    const promise = core.fetch("/api/slow", { timeout: 100 });

    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBeNull();
    // TimeoutError envelope（cancelled 軸は立てない）
    expect(core.error).toEqual({ name: "TimeoutError", message: "Request timed out after 100ms." });
    expect(errors).toHaveLength(1);
    expect(errors[0].name).toBe("TimeoutError");
    expect(core.value).toBeNull();
    expect(core.status).toBe(0);
    expect(core.loading).toBe(false);
  });

  it("timeout claim 後に到着した success は terminal CAS で drop される（timeout 後成功）", async () => {
    let resolveFetch!: (r: Response) => void;
    fetchSpy.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));

    const core = new FetchCore();
    const promise = core.fetch("/api/slow", { timeout: 100 });

    // 先に timeout を確定させる
    await vi.advanceTimersByTimeAsync(100);
    expect(core.error?.name).toBe("TimeoutError");

    // その後に success 応答が届いても observable を上書きしない
    resolveFetch(jsonResponse({ late: true }));
    await promise;

    expect(core.error).toEqual({ name: "TimeoutError", message: "Request timed out after 100ms." });
    expect(core.value).toBeNull();
    expect(core.status).toBe(0);
  });

  it("時間内に完了すると timeout タイマーは発火しない（clearTimeout）", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ data: "ok" }));

    const core = new FetchCore();
    const result = await core.fetch("/api/fast", { timeout: 1000 });
    expect(result).toEqual({ data: "ok" });
    expect(core.value).toEqual({ data: "ok" });
    expect(core.error).toBeNull();

    // 完了後にタイマー期限を越えても TimeoutError にならない
    await vi.advanceTimersByTimeAsync(2000);
    expect(core.error).toBeNull();
    expect(core.value).toEqual({ data: "ok" });
    expect(core.status).toBe(200);
  });

  it("supersede 済み operation の timeout タイマーは claim に失敗し何も書かない", async () => {
    // op1 の応答は abort を無視して settle しない → op1 は decide せず timer が armed のまま。
    fetchSpy.mockImplementationOnce(() => new Promise<Response>(() => { /* never settles */ }));
    fetchSpy.mockResolvedValueOnce(jsonResponse({ call: 2 }));

    const core = new FetchCore();
    core.fetch("/api/first", { timeout: 100 });
    const p2 = core.fetch("/api/second"); // op1 を supersede（epoch 前進）
    await p2;
    expect(core.value).toEqual({ call: 2 });

    // op1 の timer が発火しても eligibility を失っているため claim に失敗し、observable を汚さない
    await vi.advanceTimersByTimeAsync(100);
    expect(core.value).toEqual({ call: 2 });
    expect(core.error).toBeNull();
    expect(core.status).toBe(200);
  });

  it("timeout <= 0 / 未指定ならタイマーを張らない（既定は無期限）", async () => {
    let resolveFetch!: (r: Response) => void;
    fetchSpy.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));

    const core = new FetchCore();
    const promise = core.fetch("/api/slow", { timeout: 0 });

    // どれだけ進めても timeout にならない
    await vi.advanceTimersByTimeAsync(100000);
    expect(core.error).toBeNull();
    expect(core.loading).toBe(true);

    resolveFetch(jsonResponse({ eventually: true }));
    expect(await promise).toEqual({ eventually: true });
  });
});

describe("FetchCore Phase 4 — stale-write guard at commit point", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("body-read が supersede 後に resolve しても stale な success を commit しない", async () => {
    // op1: body(json) を後から手動 resolve できる応答。abort されても body は resolve 済み扱い。
    let resolveOp1Json!: (v: any) => void;
    const op1Response = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "Content-Type": "application/json" }),
      json: () => new Promise((resolve) => { resolveOp1Json = resolve; }),
      text: () => Promise.resolve("{}"),
    } as unknown as Response;

    fetchSpy.mockResolvedValueOnce(op1Response);
    fetchSpy.mockResolvedValueOnce(jsonResponse({ call: 2 }));

    const core = new FetchCore();
    const p1 = core.fetch("/api/first");
    // op2 が op1 を supersede（epoch 前進）
    const p2 = core.fetch("/api/second");

    const r2 = await p2;
    expect(r2).toEqual({ call: 2 });
    expect(core.value).toEqual({ call: 2 });

    // ここで op1 の body-read が「成功」で resolve する（abort が伝播せず body が buffer 済みの想定）
    resolveOp1Json({ call: 1, stale: true });
    const r1 = await p1;

    // 旧 world の完了は CommitGuard の epoch チェックで弾かれ、観測面は op2 のまま
    expect(r1).toBeNull();
    expect(core.value).toEqual({ call: 2 });
    expect(core.status).toBe(200);
  });

  it("supersede 済み operation の HTTP エラーは claim に失敗し stale error を書かない", async () => {
    // op1 は 404。op2 が先に supersede するため op1 の error claim は弾かれる。
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
      text: () => Promise.resolve("missing"),
    } as unknown as Response);
    fetchSpy.mockResolvedValueOnce(jsonResponse({ call: 2 }));

    const core = new FetchCore();
    const p1 = core.fetch("/api/first");
    const p2 = core.fetch("/api/second"); // op1 を supersede

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBeNull();
    expect(r2).toEqual({ call: 2 });
    // op1 の 404 error は stale として弾かれ、観測面は op2 の成功のまま
    expect(core.value).toEqual({ call: 2 });
    expect(core.status).toBe(200);
    expect(core.error).toBeNull();
  });

  it("setter が同期発火した event で同 lane を supersede すると残りの commit を止める（guard 後検査）", async () => {
    // §5.1: setter が同期 event を発火し、それが同じ lane を supersede することがある。
    // op1 の setResponse が listener 経由で op2 を起こすと、op1 の後続 setLoading(false) は
    // CommitGuard で止まる（既発生の副作用は巻き戻さない）。
    fetchSpy.mockResolvedValueOnce(jsonResponse({ call: 1 }));
    fetchSpy.mockResolvedValueOnce(jsonResponse({ call: 2 }));

    const core = new FetchCore();
    const loadingEvents: boolean[] = [];
    core.addEventListener("wcs-fetch:loading-changed", (e: Event) => loadingEvents.push((e as CustomEvent).detail));
    let superseded = false;
    core.addEventListener("wcs-fetch:response", () => {
      if (!superseded) {
        superseded = true;
        core.fetch("/api/second"); // op1 の terminal 途中で op2 が supersede
      }
    });

    await core.fetch("/api/first");
    // マイクロタスクを流して op2 の完了を待つ
    await new Promise((r) => setTimeout(r, 0));

    // op1 の setLoading(false) は guard で抑止され、loading は true→true→false（op2 の完了のみ）
    expect(loadingEvents).toEqual([true, true, false]);
    expect(core.loading).toBe(false);
    expect(core.value).toEqual({ call: 2 });
  });

  it("supersede された blob 応答は objectURL を生成せずリークしない", async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    let seq = 0;
    URL.createObjectURL = (() => { const u = `blob:leak-${++seq}`; created.push(u); return u; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((u: string) => { revoked.push(u); }) as typeof URL.revokeObjectURL;
    try {
      // op1: blob body を後から手動 resolve できる応答。
      let resolveOp1Blob!: (b: Blob) => void;
      fetchSpy.mockResolvedValueOnce({
        ok: true, status: 200, statusText: "OK", headers: new Headers({ "Content-Type": "image/png" }),
        blob: () => new Promise<Blob>((resolve) => { resolveOp1Blob = resolve; }),
      } as unknown as Response);
      fetchSpy.mockResolvedValueOnce({
        ok: true, status: 200, statusText: "OK", headers: new Headers({ "Content-Type": "image/png" }),
        blob: () => Promise.resolve(new Blob(["b"])),
      } as unknown as Response);

      const core = new FetchCore();
      const p1 = core.fetch("/a", { responseType: "blob" });
      const p2 = core.fetch("/b", { responseType: "blob" }); // op1 を supersede
      await p2;

      // op1 の blob が supersede 後に resolve しても、claim 前なので URL を作らない
      resolveOp1Blob(new Blob(["a"]));
      await p1;

      // op2（勝者）だけが 1 個生成し、リークした URL は無い
      expect(created).toEqual(["blob:leak-1"]);
      expect(core.objectURL).toBe("blob:leak-1");
      const leaked = created.filter((u) => u !== core.objectURL && !revoked.includes(u));
      expect(leaked).toEqual([]);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });

  it("dispose された blob 応答は objectURL を生成せずリークしない", async () => {
    const created: string[] = [];
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (() => { const u = `blob:disp-${created.length + 1}`; created.push(u); return u; }) as typeof URL.createObjectURL;
    try {
      let resolveBlob!: (b: Blob) => void;
      fetchSpy.mockResolvedValueOnce({
        ok: true, status: 200, statusText: "OK", headers: new Headers({ "Content-Type": "image/png" }),
        blob: () => new Promise<Blob>((resolve) => { resolveBlob = resolve; }),
      } as unknown as Response);

      const core = new FetchCore();
      const promise = core.fetch("/a", { responseType: "blob" });
      await Promise.resolve();
      core.dispose(); // owner generation bump
      resolveBlob(new Blob(["a"]));
      await promise;

      // dispose 後の blob resolve は claim に負けるため URL を一切作らない
      expect(created).toEqual([]);
      expect(core.objectURL).toBeNull();
    } finally {
      URL.createObjectURL = origCreate;
    }
  });

  it("dispose 後に body-read が resolve しても状態を書かない（owner generation）", async () => {
    let resolveJson!: (v: any) => void;
    const response = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "Content-Type": "application/json" }),
      json: () => new Promise((resolve) => { resolveJson = resolve; }),
      text: () => Promise.resolve("{}"),
    } as unknown as Response;
    fetchSpy.mockResolvedValueOnce(response);

    const core = new FetchCore();
    const promise = core.fetch("/api/slow");
    // fetch は resolve 済みだが body-read 待ち
    await Promise.resolve();

    core.dispose(); // owner generation bump
    resolveJson({ data: "stale" });
    const result = await promise;

    expect(result).toBeNull();
    expect(core.value).toBeNull();
    expect(core.status).toBe(0);
  });
});

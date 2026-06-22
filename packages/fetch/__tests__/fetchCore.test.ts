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

  it("wcBindable inputsがurl/methodを宣言している", () => {
    const inputs = FetchCore.wcBindable.inputs!;
    expect(inputs.map((i) => i.name)).toEqual(["url", "method"]);
    // Core は headless なので attribute ヒントは持たない
    expect(inputs.every((i) => i.attribute === undefined)).toBe(true);
  });

  it("wcBindable commandsがfetch(async)/abortを宣言している", () => {
    const commands = FetchCore.wcBindable.commands!;
    expect(commands.map((c) => c.name)).toEqual(["fetch", "abort"]);
    expect(commands.find((c) => c.name === "fetch")!.async).toBe(true);
    expect(commands.find((c) => c.name === "abort")!.async).toBeUndefined();
  });

  it("wcBindable inputs/commandsのnameがそれぞれ一意である", () => {
    const inputNames = FetchCore.wcBindable.inputs!.map((i) => i.name);
    const commandNames = FetchCore.wcBindable.commands!.map((c) => c.name);
    expect(new Set(inputNames).size).toBe(inputNames.length);
    expect(new Set(commandNames).size).toBe(commandNames.length);
  });

  it("valueのgetterがdetail.valueを返す", () => {
    const getter = FetchCore.wcBindable.properties[0].getter!;
    const event = new CustomEvent("wcs-fetch:response", { detail: { value: "test", status: 200 } });
    expect(getter(event)).toBe("test");
  });

  it("statusのgetterがdetail.statusを返す", () => {
    const getter = FetchCore.wcBindable.properties[3].getter!;
    const event = new CustomEvent("wcs-fetch:response", { detail: { value: "test", status: 200 } });
    expect(getter(event)).toBe(200);
  });

  it("初期状態が正しい", () => {
    const core = new FetchCore();
    expect(core.value).toBeNull();
    expect(core.loading).toBe(false);
    expect(core.error).toBeNull();
    expect(core.status).toBe(0);
    expect(core.promise).toBeInstanceOf(Promise);
  });

  it("promiseプロパティがfetch完了時に解決される", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ data: "test" }));

    const core = new FetchCore();
    core.fetch("/api/test");
    const result = await core.promise;

    expect(result).toEqual({ data: "test" });
    expect(core.loading).toBe(false);
  });

  it("promiseプロパティが最新のfetchを反映する", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ call: 1 }));
    fetchSpy.mockResolvedValueOnce(createMockResponse({ call: 2 }));

    const core = new FetchCore();
    core.fetch("/api/first");
    core.fetch("/api/second");
    const result = await core.promise;

    expect(result).toEqual({ call: 2 });
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

  it("HEADリクエストではボディを読まずstatusのみ取得する", async () => {
    // HEAD レスポンスは仕様上ボディを持たない。Content-Type が json でも
    // json() を呼ぶと空ボディの parse error になるため、ボディ読取をスキップして
    // value=null・status のみを通知することを確認する。
    const response = createMockResponse(null, { status: 200, contentType: "application/json" });
    // 空ボディの HEAD で json()/text() が呼ばれていないことを検証するためにスパイ化
    const jsonSpy = vi.spyOn(response, "json");
    const textSpy = vi.spyOn(response, "text");
    fetchSpy.mockResolvedValueOnce(response);

    const core = new FetchCore();
    const result = await core.fetch("/api/resource", { method: "HEAD" });

    expect(result).toBeNull();
    expect(core.value).toBeNull();
    expect(core.status).toBe(200);
    expect(core.error).toBeNull();
    expect(core.loading).toBe(false);
    // ボディは一切読まれない
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(textSpy).not.toHaveBeenCalled();

    // 送信側でも body は付かない
    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).method).toBe("HEAD");
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
    // fetch開始時に null（エラークリア）、HTTPエラー時にエラーオブジェクトの2回発火
    expect(errors).toHaveLength(2);
    expect(errors[0]).toBeNull();
    expect(errors[1].status).toBe(404);
    expect(errors[1].statusText).toBe("Error");
    // The already-read response text is part of the error object, so consumers can
    // surface the server's message (e.g. a validation reason) by binding error.body.
    expect(errors[1].body).toBe("Not Found");
  });

  it("HTTPエラー時もstatus観測者にwcs-fetch:responseが届く", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse("Not Found", { status: 404, ok: false }));

    const core = new FetchCore();
    const statusGetter = FetchCore.wcBindable.properties[3].getter!;
    const valueGetter = FetchCore.wcBindable.properties[0].getter!;
    const responses: { status: number; value: any }[] = [];
    core.addEventListener("wcs-fetch:response", (e: Event) => {
      responses.push({ status: statusGetter(e), value: valueGetter(e) });
    });

    await core.fetch("/api/missing");

    // status 観測者は wcs-fetch:response 経由で通知を受ける。エラー時も発火する。
    expect(responses).toHaveLength(1);
    expect(responses[0].status).toBe(404);
    // エラー時は value を null として通知する
    expect(responses[0].value).toBeNull();
  });

  it("ネットワークエラーを処理できる", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const core = new FetchCore();
    const result = await core.fetch("/api/error");

    expect(result).toBeNull();
    expect(core.error).toBeInstanceOf(TypeError);
    expect(core.loading).toBe(false);
  });

  it("ネットワークエラー時はvalue/statusがリセットされる（直前の成功値が残らない）", async () => {
    // 1回目: 成功して value/status を持たせる
    fetchSpy.mockResolvedValueOnce(createMockResponse({ data: "ok" }, { status: 200 }));
    const core = new FetchCore();
    await core.fetch("/api/first");
    expect(core.value).toEqual({ data: "ok" });
    expect(core.status).toBe(200);

    // 2回目: ネットワークエラー。HTTP エラー経路と同様に value=null・status=0 へ
    // リセットされ、直前の成功値が観測者に残らないことを確認する。
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const statusGetter = FetchCore.wcBindable.properties[3].getter!;
    const valueGetter = FetchCore.wcBindable.properties[0].getter!;
    const responses: { status: number; value: any }[] = [];
    core.addEventListener("wcs-fetch:response", (e: Event) => {
      responses.push({ status: statusGetter(e), value: valueGetter(e) });
    });

    await core.fetch("/api/error");

    expect(core.error).toBeInstanceOf(TypeError);
    expect(core.value).toBeNull();
    expect(core.status).toBe(0);
    // status 観測者（wcs-fetch:response 経由）にも 0 が通知される
    expect(responses).toEqual([{ status: 0, value: null }]);
  });

  it("url未指定時はerrorに流しnullを返す（never-throw）", async () => {
    const core = new FetchCore();
    const result = await core.fetch("");
    expect(result).toBeNull();
    expect(core.error).toEqual({ message: "url attribute is required." });
    // fetch は実行されない
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ready は解決済み Promise を返す", async () => {
    const core = new FetchCore();
    await expect(core.ready).resolves.toBeUndefined();
  });

  it("observe() は ready を返し、冪等に再呼び出しできる", async () => {
    const core = new FetchCore();
    await expect(core.observe()).resolves.toBeUndefined();
    await expect(core.observe()).resolves.toBeUndefined();
  });

  it("dispose() は進行中のリクエストを abort する", async () => {
    const aborted: boolean[] = [];
    fetchSpy.mockImplementationOnce((_url, init) => {
      return new Promise((_resolve, reject) => {
        (init as RequestInit).signal?.addEventListener("abort", () => {
          aborted.push(true);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const core = new FetchCore();
    const promise = core.fetch("/api/slow");
    core.dispose();

    const result = await promise;
    expect(result).toBeNull();
    expect(aborted).toEqual([true]);
  });

  it("dispose 後に resolve した stale レスポンスは状態を書かない（_gen ガード）", async () => {
    // dispose() が in-flight 中に _gen を進めるため、その後に fetch が成功で
    // resolve しても value/status/loading を書き換えないことを確認する。
    let resolveFetch!: (r: Response) => void;
    fetchSpy.mockImplementationOnce(() => {
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });

    const core = new FetchCore();
    const promise = core.fetch("/api/slow");
    expect(core.loading).toBe(true);

    core.dispose(); // _gen を進める
    // dispose 後にレスポンスが届く
    resolveFetch(createMockResponse({ data: "stale" }, { status: 200 }));

    const result = await promise;
    expect(result).toBeNull();
    // stale なので value/status は初期値のまま
    expect(core.value).toBeNull();
    expect(core.status).toBe(0);
  });

  it("dispose 後に reject した stale エラーは状態を書かない（_gen ガード/catch）", async () => {
    // AbortError 以外の例外（response.json() 中の reject 等）が dispose 後に
    // 起きても、stale 世代なので error を書かないことを確認する。
    let rejectFetch!: (e: any) => void;
    fetchSpy.mockImplementationOnce(() => {
      return new Promise<Response>((_resolve, reject) => {
        rejectFetch = reject;
      });
    });

    const core = new FetchCore();
    const promise = core.fetch("/api/slow");

    core.dispose(); // _gen を進める
    rejectFetch(new TypeError("Failed to fetch")); // AbortError ではない

    const result = await promise;
    expect(result).toBeNull();
    // stale なので error は書かれない（dispose 後の initial 値のまま null）
    expect(core.error).toBeNull();
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

  it("2回目のfetch()が1回目をabortしてもloadingがちらつかない", async () => {
    // 連続 fetch では後発が先発を abort する。先発の AbortError catch が
    // loading=false を発火すると、後発が進行中にも関わらず observer が
    // 一瞬 loading=false を見てしまう。後発が引き継いでいる場合は先発由来の
    // loading=false を抑制し、loading が true→true→...→false の単調な流れに
    // なることを確認する。
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
    const loadingEvents: boolean[] = [];
    core.addEventListener("wcs-fetch:loading-changed", (e: Event) => {
      loadingEvents.push((e as CustomEvent).detail);
    });

    const promise1 = core.fetch("/api/first");
    const promise2 = core.fetch("/api/second"); // 1回目を abort する

    await Promise.all([promise1, promise2]);

    // 先発の abort 由来の loading=false は抑制される。
    // loading=true（先発）→loading=true（後発）→loading=false（後発完了）の3回のみ。
    expect(loadingEvents).toEqual([true, true, false]);
    expect(core.loading).toBe(false);
  });

  it("1回目のabort後のfinallyが2回目のcontrollerを誤って無効化しない", async () => {
    // 1回目: abort されると即座に reject、その finally が走るのを待ってから
    // 2回目を abort() できることを確認する（controller の同一性チェック）。
    const aborts: number[] = [];
    let callCount = 0;
    fetchSpy.mockImplementation((_url, init) => {
      callCount++;
      const currentCall = callCount;
      return new Promise((_resolve, reject) => {
        (init as RequestInit).signal?.addEventListener("abort", () => {
          aborts.push(currentCall);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const core = new FetchCore();
    const promise1 = core.fetch("/api/first");
    const promise2 = core.fetch("/api/second"); // 1回目を abort する
    // 1回目の reject と finally が確実に流れるまで待つ
    await promise1;

    // 2回目はまだ進行中。abort() が効くこと（同一性チェックにより controller が
    // 1回目の finally で null 化されていないこと）を確認する。
    core.abort();
    const result2 = await promise2;

    expect(result2).toBeNull();
    expect(aborts).toEqual([1, 2]);
    expect(core.loading).toBe(false);
  });

  it("呼び出し側のheadersオブジェクトを汚染しない", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const core = new FetchCore();
    const callerHeaders: Record<string, string> = { Accept: "application/json" };
    await core.fetch("/api/test", {
      method: "POST",
      headers: callerHeaders,
      body: "data",
      contentType: "application/json",
    });

    // contentType の注入は内部コピーに対して行われ、呼び出し側 obj は不変。
    expect(callerHeaders).toEqual({ Accept: "application/json" });
    expect(callerHeaders).not.toHaveProperty("Content-Type");
    // 一方でリクエストには Content-Type が乗っている
    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({ "Content-Type": "application/json", Accept: "application/json" })
    );
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

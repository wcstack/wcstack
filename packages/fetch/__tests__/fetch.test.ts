import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Fetch } from "../src/components/Fetch";
import { FetchHeader } from "../src/components/FetchHeader";
import { FetchBody } from "../src/components/FetchBody";
import { InfiniteScroll } from "../src/components/InfiniteScroll";
import { bootstrapFetch } from "../src/bootstrapFetch";
import { registerComponents } from "../src/registerComponents";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";
import { config, setConfig, getConfig } from "../src/config";

// registerComponents経由でカスタム要素を登録
registerComponents();

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

describe("config", () => {
  it("デフォルト設定を取得できる", () => {
    expect(config.tagNames.fetch).toBe("wcs-fetch");
    expect(config.tagNames.fetchHeader).toBe("wcs-fetch-header");
    expect(config.tagNames.fetchBody).toBe("wcs-fetch-body");
    expect(config.tagNames.infiniteScroll).toBe("wcs-infinite-scroll");
    expect(config.autoTrigger).toBe(true);
    expect(config.triggerAttribute).toBe("data-fetchtarget");
  });

  it("getConfig()でフリーズされたコピーを取得できる", () => {
    const frozen = getConfig();
    expect(frozen.tagNames.fetch).toBe("wcs-fetch");
    expect(Object.isFrozen(frozen)).toBe(true);
    // 2回目の呼び出しも同じオブジェクト
    const frozen2 = getConfig();
    expect(frozen).toBe(frozen2);
  });

  it("setConfig()で部分的に設定を変更できる", () => {
    setConfig({ autoTrigger: false });
    expect(config.autoTrigger).toBe(false);
    // 元に戻す
    setConfig({ autoTrigger: true });
    expect(config.autoTrigger).toBe(true);
  });

  it("setConfig()でtagNamesを変更できる", () => {
    setConfig({ tagNames: { fetch: "my-fetch" } });
    expect(config.tagNames.fetch).toBe("my-fetch");
    // 元に戻す
    setConfig({ tagNames: { fetch: "wcs-fetch" } });
  });

  it("setConfig()でtriggerAttributeを変更できる", () => {
    setConfig({ triggerAttribute: "data-trigger" });
    expect(config.triggerAttribute).toBe("data-trigger");
    // 元に戻す
    setConfig({ triggerAttribute: "data-fetchtarget" });
  });

  it("setConfig()後にgetConfig()のキャッシュがリセットされる", () => {
    const frozen1 = getConfig();
    setConfig({ autoTrigger: false });
    const frozen2 = getConfig();
    expect(frozen1).not.toBe(frozen2);
    // 元に戻す
    setConfig({ autoTrigger: true });
  });
});

describe("FetchHeader", () => {
  it("DOM追加時に非表示になる", () => {
    const el = document.createElement("wcs-fetch-header") as FetchHeader;
    document.body.appendChild(el);
    expect(el.style.display).toBe("none");
    el.remove();
  });

  it("name属性とvalue属性を取得できる", () => {
    const el = document.createElement("wcs-fetch-header") as FetchHeader;
    el.setAttribute("name", "Authorization");
    el.setAttribute("value", "Bearer token123");
    expect(el.headerName).toBe("Authorization");
    expect(el.headerValue).toBe("Bearer token123");
  });

  it("属性が未設定の場合は空文字を返す", () => {
    const el = document.createElement("wcs-fetch-header") as FetchHeader;
    expect(el.headerName).toBe("");
    expect(el.headerValue).toBe("");
  });
});

describe("FetchBody", () => {
  it("Shadow DOMによりlight DOMが描画されない", () => {
    const el = document.createElement("wcs-fetch-body") as FetchBody;
    el.textContent = '{"key": "value"}';
    expect(el.shadowRoot).not.toBeNull();
    expect(el.shadowRoot!.childNodes).toHaveLength(0);
  });

  it("type属性を取得できる", () => {
    const el = document.createElement("wcs-fetch-body") as FetchBody;
    el.setAttribute("type", "text/plain");
    expect(el.contentType).toBe("text/plain");
  });

  it("type未設定時はapplication/jsonをデフォルトにする", () => {
    const el = document.createElement("wcs-fetch-body") as FetchBody;
    expect(el.contentType).toBe("application/json");
  });

  it("テキストコンテンツを取得できる", () => {
    const el = document.createElement("wcs-fetch-body") as FetchBody;
    el.textContent = '{"name": "test"}';
    expect(el.bodyContent).toBe('{"name": "test"}');
  });

  it("テキストコンテンツが空の場合は空文字を返す", () => {
    const el = document.createElement("wcs-fetch-body") as FetchBody;
    expect(el.bodyContent).toBe("");
  });
});

describe("Fetch", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    // Default resolution so any stray fire-and-forget fetch (e.g. an
    // attributeChangedCallback re-fetch scheduled after a one-shot mock is
    // consumed) resolves to a mock instead of falling through to the real
    // network (which would try to connect to localhost:3000 and emit an
    // ECONNREFUSED unhandled rejection). Tests that need specific responses
    // still override with mockResolvedValueOnce / mockResolvedValue.
    fetchSpy.mockResolvedValue(createMockResponse({ ok: true }));
  });

  afterEach(() => {
    // Detach all elements before restoring the spy. Removing a connected
    // <wcs-fetch> fires disconnectedCallback -> abort(), so any in-flight or
    // microtask-queued request is cancelled while the mock is still active,
    // never reaching the real fetch after mockRestore().
    document.body.innerHTML = "";
    fetchSpy.mockRestore();
  });

  it("DOM追加時に非表示になる", () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("manual", "");
    document.body.appendChild(el);
    expect(el.style.display).toBe("none");
  });

  it("wcBindableプロパティが正しく定義されている", () => {
    expect(Fetch.wcBindable.protocol).toBe("wc-bindable");
    expect(Fetch.wcBindable.version).toBe(1);
    expect(Fetch.wcBindable.properties).toHaveLength(7);
    expect(Fetch.wcBindable.properties[0].name).toBe("value");
    expect(Fetch.wcBindable.properties[1].name).toBe("loading");
    expect(Fetch.wcBindable.properties[2].name).toBe("error");
    expect(Fetch.wcBindable.properties[3].name).toBe("status");
    expect(Fetch.wcBindable.properties[4].name).toBe("objectURL");
    expect(Fetch.wcBindable.properties[5].name).toBe("errorInfo");
    expect(Fetch.wcBindable.properties[5].event).toBe("wcs-fetch:error-info-changed");
    expect(Fetch.wcBindable.properties[6].name).toBe("trigger");
    expect(Fetch.wcBindable.properties[6].event).toBe("wcs-fetch:trigger-changed");
  });

  it("wcBindable inputsがShellの設定可能サーフェスを宣言している", () => {
    const inputs = Fetch.wcBindable.inputs!;
    expect(inputs.map((i) => i.name)).toEqual(["url", "method", "target", "manual", "body", "responseType", "trigger"]);
  });

  it("wcBindable inputsはattributeヒントを持たない（setterが自己反映するため二重設定を避ける）", () => {
    const inputs = Fetch.wcBindable.inputs!;
    expect(inputs.every((i) => i.attribute === undefined)).toBe(true);
  });

  it("wcBindable commandsをCoreからfetch(async)/abortとして継承している", () => {
    const commands = Fetch.wcBindable.commands!;
    expect(commands.map((c) => c.name)).toEqual(["fetch", "abort"]);
    expect(commands.find((c) => c.name === "fetch")!.async).toBe(true);
  });

  it("triggerはproperties（観測）とinputs（設定）の両方に現れる", () => {
    expect(Fetch.wcBindable.properties.some((p) => p.name === "trigger")).toBe(true);
    expect(Fetch.wcBindable.inputs!.some((i) => i.name === "trigger")).toBe(true);
  });

  it("valueのgetterがdetail.valueを返す", () => {
    const getter = Fetch.wcBindable.properties[0].getter!;
    const event = new CustomEvent("wcs-fetch:response", { detail: { value: "test", status: 200 } });
    expect(getter(event)).toBe("test");
  });

  it("statusのgetterがdetail.statusを返す", () => {
    const getter = Fetch.wcBindable.properties[3].getter!;
    const event = new CustomEvent("wcs-fetch:response", { detail: { value: "test", status: 200 } });
    expect(getter(event)).toBe(200);
  });

  it("url属性の取得と設定ができる", () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    expect(el.url).toBe("");
    el.url = "/api/test";
    expect(el.url).toBe("/api/test");
    expect(el.getAttribute("url")).toBe("/api/test");
  });

  it("method属性のデフォルトはGET", () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    expect(el.method).toBe("GET");
  });

  it("method属性を設定できる", () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    el.method = "POST";
    expect(el.method).toBe("POST");
  });

  it("method属性は大文字に変換される", () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("method", "post");
    expect(el.method).toBe("POST");
  });

  it("target属性の取得と設定ができる", () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    expect(el.target).toBeNull();
    el.target = "result-area";
    expect(el.target).toBe("result-area");
    el.target = null;
    expect(el.target).toBeNull();
  });

  describe("setter の null/undefined 正規化（文字列化防御）", () => {
    it("url に undefined/null を代入すると属性が削除される（'undefined' へ fetch しない）", () => {
      const el = document.createElement("wcs-fetch") as Fetch;
      el.url = "/api/test";
      el.url = undefined as any;
      expect(el.hasAttribute("url")).toBe(false);
      expect(el.url).toBe("");
      el.url = "/api/test";
      el.url = null as any;
      expect(el.hasAttribute("url")).toBe(false);
    });

    it("method に undefined/null を代入すると属性が削除されデフォルト GET に戻る", () => {
      const el = document.createElement("wcs-fetch") as Fetch;
      el.method = "POST";
      el.method = undefined as any;
      expect(el.hasAttribute("method")).toBe(false);
      expect(el.method).toBe("GET");
      el.method = "POST";
      el.method = null as any;
      expect(el.method).toBe("GET");
    });

    it("target に undefined を代入すると null と同様に属性が削除される", () => {
      const el = document.createElement("wcs-fetch") as Fetch;
      el.target = "result-area";
      el.target = undefined as any;
      expect(el.target).toBeNull();
      expect(el.hasAttribute("target")).toBe(false);
    });

    it("body に undefined を代入すると null に正規化される（JSON body 化しない）", () => {
      const el = document.createElement("wcs-fetch") as Fetch;
      el.body = { name: "x" };
      el.body = undefined;
      expect(el.body).toBeNull();
    });
  });

  it("manual属性の取得と設定ができる", () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    expect(el.manual).toBe(false);
    el.manual = true;
    expect(el.manual).toBe(true);
    expect(el.hasAttribute("manual")).toBe(true);
    el.manual = false;
    expect(el.manual).toBe(false);
    expect(el.hasAttribute("manual")).toBe(false);
  });

  it("body プロパティの取得と設定ができる", () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    expect(el.body).toBeNull();
    el.body = { name: "test" };
    expect(el.body).toEqual({ name: "test" });
  });

  it("connectedCallbackでurl指定時に自動実行される", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ auto: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/auto");
    document.body.appendChild(el);

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(el.value).toEqual({ auto: true });
    });
  });

  it("manual属性がある場合はconnectedCallbackで自動実行されない", () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/manual");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("url未設定時はconnectedCallbackで自動実行されない", () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    document.body.appendChild(el);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("接続後にurl属性が変更されると自動実行される", async () => {
    fetchSpy.mockResolvedValue(createMockResponse({ data: "test" }));

    const el = document.createElement("wcs-fetch") as Fetch;
    document.body.appendChild(el);
    expect(fetchSpy).not.toHaveBeenCalled();

    el.setAttribute("url", "/api/test");

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("url属性が空に変更された場合は自動実行されない", async () => {
    fetchSpy.mockResolvedValue(createMockResponse({ data: "test" }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    document.body.appendChild(el);

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    fetchSpy.mockClear();
    el.setAttribute("url", "");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("manual属性がある場合はurl変更でも自動実行されない", () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    el.setAttribute("url", "/api/test");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("未接続時のurl変更では自動実行されない", () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("url属性が別の値に変更されると再度自動実行される", async () => {
    fetchSpy.mockResolvedValue(createMockResponse({ data: "test" }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/users");
    document.body.appendChild(el);

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    el.setAttribute("url", "/api/users?role=admin");

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("url未設定時にfetch()を呼ぶとerrorに流しnullを返す（never-throw）", async () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    const result = await el.fetch();
    expect(result).toBeNull();
    expect(el.error).toEqual({ message: "url attribute is required." });
    // Shell は errorInfo を Core から転送する（bindable 出力）
    expect(el.errorInfo).toEqual({
      code: "invalid-argument", phase: "start", recoverable: false,
      message: "url attribute is required.",
    });
  });

  it("GETリクエストでJSONレスポンスを取得できる", async () => {
    const mockData = { users: [{ id: 1, name: "田中" }] };
    fetchSpy.mockResolvedValueOnce(createMockResponse(mockData));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/users");

    const events: string[] = [];
    el.addEventListener("wcs-fetch:loading-changed", () => events.push("loading"));
    el.addEventListener("wcs-fetch:response", () => events.push("response"));

    const result = await el.fetch();

    expect(result).toEqual(mockData);
    expect(el.value).toEqual(mockData);
    expect(el.status).toBe(200);
    expect(el.loading).toBe(false);
    expect(el.error).toBeNull();
    expect(events).toEqual(["loading", "response", "loading"]);
  });

  it("テキストレスポンスを取得できる", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse("hello", { contentType: "text/plain" }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/text");

    const result = await el.fetch();
    expect(result).toBe("hello");
  });

  it("Content-Typeヘッダがない場合はテキストとして処理する", async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: () => Promise.resolve({}),
      text: () => Promise.resolve("no content type"),
    } as unknown as Response;
    fetchSpy.mockResolvedValueOnce(response);

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/no-content-type");

    const result = await el.fetch();
    expect(result).toBe("no content type");
  });

  it("HTTPエラーレスポンスを処理できる", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse("Not Found", { status: 404, ok: false }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/missing");

    const errors: any[] = [];
    el.addEventListener("wcs-fetch:error", (e: Event) => {
      errors.push((e as CustomEvent).detail);
    });

    const responses: number[] = [];
    el.addEventListener("wcs-fetch:response", (e: Event) => {
      responses.push((e as CustomEvent).detail.status);
    });

    const result = await el.fetch();

    expect(result).toBeNull();
    expect(el.status).toBe(404);
    // fetch開始時の null クリアは同値ガードで抑止され（error は既に null）、
    // HTTPエラー時のエラーオブジェクトのみ1回発火する
    expect(errors).toHaveLength(1);
    expect(errors[0].status).toBe(404);
    // status はターゲットインジェクションにより Shell でも wcs-fetch:response 経由で届く
    expect(responses).toEqual([404]);
  });

  it("ネットワークエラーを処理できる", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/error");

    const result = await el.fetch();

    expect(result).toBeNull();
    expect(el.error).toBeInstanceOf(TypeError);
    expect(el.loading).toBe(false);
  });

  it("ネットワークエラー時はvalue/statusがリセットされる", async () => {
    // 1回目成功 → 2回目ネットワークエラー で直前の value/status が残らないこと
    fetchSpy.mockResolvedValueOnce(createMockResponse({ data: "ok" }, { status: 200 }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/first");
    await el.fetch();
    expect(el.value).toEqual({ data: "ok" });
    expect(el.status).toBe(200);

    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    el.setAttribute("url", "/api/error");
    await el.fetch();

    expect(el.error).toBeInstanceOf(TypeError);
    expect(el.value).toBeNull();
    expect(el.status).toBe(0);
  });

  it("サブタグからヘッダを収集できる", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");

    const header1 = document.createElement("wcs-fetch-header") as FetchHeader;
    header1.setAttribute("name", "Authorization");
    header1.setAttribute("value", "Bearer token");
    el.appendChild(header1);

    const header2 = document.createElement("wcs-fetch-header") as FetchHeader;
    header2.setAttribute("name", "Accept");
    header2.setAttribute("value", "application/json");
    el.appendChild(header2);

    await el.fetch();

    const [url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).headers).toEqual({
      "Authorization": "Bearer token",
      "Accept": "application/json",
    });
  });

  it("POSTリクエストでbodyプロパティからボディを送信できる", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ created: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/users");
    el.setAttribute("method", "POST");
    el.body = { name: "新しいユーザー" };

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBe('{"name":"新しいユーザー"}');
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({ "Content-Type": "application/json" })
    );
  });

  it("POSTリクエストで文字列bodyを送信できる", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    el.setAttribute("method", "POST");
    el.body = "raw text body";

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).body).toBe("raw text body");
  });

  it("HEADリクエストはボディを読まずstatusのみを反映する", async () => {
    const json = vi.fn();
    const text = vi.fn();
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 204,
      statusText: "No Content",
      headers: new Headers(),
      json,
      text,
    } as unknown as Response);

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/users");
    el.setAttribute("method", "HEAD");

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).method).toBe("HEAD");
    // HEADはボディを持たないため、json()/text()は呼ばずに読み取りをスキップする
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(el.value).toBeNull();
    expect(el.status).toBe(204);
    expect(el.error).toBeNull();
  });

  it("サブタグからボディを収集できる", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    el.setAttribute("method", "POST");

    const bodyEl = document.createElement("wcs-fetch-body") as FetchBody;
    bodyEl.setAttribute("type", "application/json");
    bodyEl.textContent = '{"key": "value"}';
    el.appendChild(bodyEl);

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).body).toBe('{"key": "value"}');
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({ "Content-Type": "application/json" })
    );
  });

  it("サブタグのbodyContentが空の場合はbodyがnullになる", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    el.setAttribute("method", "POST");

    const bodyEl = document.createElement("wcs-fetch-body") as FetchBody;
    el.appendChild(bodyEl);

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).body).toBeUndefined();
  });

  it("bodyプロパティがサブタグより優先される", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    el.setAttribute("method", "POST");
    el.body = { priority: "high" };

    const bodyEl = document.createElement("wcs-fetch-body") as FetchBody;
    bodyEl.textContent = '{"priority": "low"}';
    el.appendChild(bodyEl);

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).body).toBe('{"priority":"high"}');
  });

  it("Blob bodyはJSON化せず素通しし、Content-Typeを付与しない", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/upload");
    el.setAttribute("method", "POST");
    const blob = new Blob(["binary"], { type: "application/octet-stream" });
    el.body = blob;

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).body).toBe(blob);
    expect((init as RequestInit).headers).not.toHaveProperty("Content-Type");
  });

  it("File body(Blobサブクラス)も素通しする", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/upload");
    el.setAttribute("method", "POST");
    const file = new File(["text"], "a.txt", { type: "text/plain" });
    el.body = file;

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).body).toBe(file);
  });

  it("FormData bodyは素通しし、boundaryをブラウザに任せるためContent-Typeを付与しない", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/upload");
    el.setAttribute("method", "POST");
    const fd = new FormData();
    fd.append("field", "value");
    el.body = fd;

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).body).toBe(fd);
    expect((init as RequestInit).headers).not.toHaveProperty("Content-Type");
  });

  it("URLSearchParams bodyを素通しする", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/form");
    el.setAttribute("method", "POST");
    const params = new URLSearchParams({ a: "1" });
    el.body = params;

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).body).toBe(params);
  });

  it("ArrayBuffer bodyを素通しする", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/bin");
    el.setAttribute("method", "POST");
    const buffer = new ArrayBuffer(8);
    el.body = buffer;

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).body).toBe(buffer);
  });

  it("TypedArray(Uint8Array) bodyを素通しする", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/bin");
    el.setAttribute("method", "POST");
    const view = new Uint8Array([1, 2, 3]);
    el.body = view;

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).body).toBe(view);
  });

  it("FormDataに手動Content-Typeを付けると警告する", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/upload");
    el.setAttribute("method", "POST");
    el.body = new FormData();

    const headerEl = document.createElement("wcs-fetch-header") as FetchHeader;
    headerEl.setAttribute("name", "Content-Type");
    headerEl.setAttribute("value", "multipart/form-data");
    el.appendChild(headerEl);

    await el.fetch();

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("FormData");
    warnSpy.mockRestore();
  });

  it("FormDataでもContent-Type以外のヘッダのみなら警告しない", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/upload");
    el.setAttribute("method", "POST");
    el.body = new FormData();

    const headerEl = document.createElement("wcs-fetch-header") as FetchHeader;
    headerEl.setAttribute("name", "Accept");
    headerEl.setAttribute("value", "application/json");
    el.appendChild(headerEl);

    await el.fetch();

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("GETリクエストではbodyを送信しない", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    el.body = { data: "ignored" };

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).body).toBeUndefined();
  });

  it("response-type=blob属性でBlobを取得しobjectURLを公開する", async () => {
    const blob = new Blob(["img"], { type: "image/png" });
    fetchSpy.mockResolvedValueOnce({
      ok: true, status: 200, statusText: "OK",
      headers: new Headers({ "Content-Type": "image/png" }),
      blob: () => Promise.resolve(blob),
    } as unknown as Response);

    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (() => "blob:shell-1") as typeof URL.createObjectURL;
    try {
      const el = document.createElement("wcs-fetch") as Fetch;
      el.setAttribute("url", "/api/image");
      el.setAttribute("response-type", "blob");

      const result = await el.fetch();
      expect(result).toBe(blob);
      expect(el.value).toBe(blob);
      expect(el.objectURL).toBe("blob:shell-1");
    } finally {
      URL.createObjectURL = origCreate;
    }
  });

  it("targetが指定されるとresponse-type=blobより優先しテキストとして処理する", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse("<p>hi</p>", { contentType: "text/html" }));

    const targetDiv = document.createElement("div");
    targetDiv.id = "replace-target-blob";
    document.body.appendChild(targetDiv);
    try {
      const el = document.createElement("wcs-fetch") as Fetch;
      el.setAttribute("url", "/api/partial");
      el.setAttribute("target", "replace-target-blob");
      el.setAttribute("response-type", "blob");

      const result = await el.fetch();
      expect(result).toBe("<p>hi</p>");
      expect(targetDiv.innerHTML).toBe("<p>hi</p>");
      expect(el.objectURL).toBeNull();
    } finally {
      targetDiv.remove();
    }
  });

  it("responseType getter/setterがresponse-type属性に反映される", () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    expect(el.responseType).toBe("auto");
    el.responseType = "blob";
    expect(el.getAttribute("response-type")).toBe("blob");
    expect(el.responseType).toBe("blob");
    el.responseType = null;
    expect(el.hasAttribute("response-type")).toBe(false);
    expect(el.responseType).toBe("auto");
  });

  it("target属性指定時にHTMLリプレースを行う", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse("<p>新しいコンテンツ</p>", { contentType: "text/html" }));

    const targetDiv = document.createElement("div");
    targetDiv.id = "target-area";
    targetDiv.innerHTML = "<p>古いコンテンツ</p>";
    document.body.appendChild(targetDiv);

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/partial");
    el.setAttribute("target", "target-area");

    await el.fetch();

    expect(targetDiv.innerHTML).toBe("<p>新しいコンテンツ</p>");
    expect(el.value).toBe("<p>新しいコンテンツ</p>");
  });

  it("target要素が存在しない場合でもエラーにならない", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse("<p>content</p>", { contentType: "text/html" }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/partial");
    el.setAttribute("target", "nonexistent");

    const result = await el.fetch();
    expect(result).toBe("<p>content</p>");
  });

  it("abort()で進行中のリクエストをキャンセルできる", async () => {
    fetchSpy.mockImplementationOnce((_url, init) => {
      return new Promise((_resolve, reject) => {
        (init as RequestInit).signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/slow");

    const fetchPromise = el.fetch();
    el.abort();

    const result = await fetchPromise;
    expect(result).toBeNull();
    expect(el.loading).toBe(false);
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

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");

    const promise1 = el.fetch();
    const promise2 = el.fetch();

    const [result1, result2] = await Promise.all([promise1, promise2]);
    expect(result1).toBeNull(); // キャンセルされた
    expect(result2).toEqual({ call: 2 });
  });

  it("fetch()後にbodyがリセットされる", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    el.setAttribute("method", "POST");
    el.body = { data: "test" };

    await el.fetch();
    expect(el.body).toBeNull();
  });

  it("fetch()は開始時にbodyを同期リセットする（await前）", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    el.setAttribute("method", "POST");
    el.body = { data: "first" };

    const p = el.fetch();
    // await を挟まずに同期的にリセットされている
    expect(el.body).toBeNull();
    await p;

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).body).toBe('{"data":"first"}');
  });

  it("進行中fetchの完了が後発のbodyを消さない", async () => {
    let resolveFirst: ((r: Response) => void) | null = null;
    fetchSpy.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    el.setAttribute("method", "POST");
    el.body = { data: "first" };

    const p1 = el.fetch(); // body を消費（同期リセット）し pending のまま
    expect(el.body).toBeNull();

    // 1回目が pending の間に、次回用の body を設定する
    el.body = { data: "second" };

    // 1回目を完了させる
    resolveFirst!(createMockResponse({ ok: true }));
    await p1;

    // 1回目の完了が後発の body を消していないこと
    expect(el.body).toEqual({ data: "second" });
  });

  it("disconnectedCallbackでリクエストがキャンセルされる", async () => {
    // Persistent abortable mock: appendChild triggers an auto-fetch and the
    // explicit fetch() below supersedes it, so BOTH requests must be abortable
    // (mockImplementation, not Once) for disconnectedCallback's abort() to
    // cancel the request awaited here.
    fetchSpy.mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        (init as RequestInit).signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/slow");
    document.body.appendChild(el);

    const fetchPromise = el.fetch();
    el.remove(); // disconnectedCallback発火

    const result = await fetchPromise;
    expect(result).toBeNull();
  });

  it("Content-Typeヘッダが明示的に設定されている場合は上書きしない", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    el.setAttribute("method", "POST");

    const header = document.createElement("wcs-fetch-header") as FetchHeader;
    header.setAttribute("name", "Content-Type");
    header.setAttribute("value", "text/xml");
    el.appendChild(header);

    el.body = { data: "test" };

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({ "Content-Type": "text/xml" })
    );
  });

  it("HTTPエラー時にレスポンスボディの取得に失敗しても処理を続行する", async () => {
    const errorResponse = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers({ "Content-Type": "application/json" }),
      json: () => Promise.reject(new Error("parse error")),
      text: () => Promise.reject(new Error("read error")),
    } as unknown as Response;
    fetchSpy.mockResolvedValueOnce(errorResponse);

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/error");

    const result = await el.fetch();
    expect(result).toBeNull();
    expect(el.error).toBeDefined();
    expect(el.error.status).toBe(500);
    expect(el.error.body).toBe("");
  });

  it("triggerをtrueに設定するとfetch()が実行される", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ triggered: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    el.trigger = true;

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(el.value).toEqual({ triggered: true });
    });
  });

  it("trigger完了後にfalseにリセットされイベントが発火する", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    const events: boolean[] = [];
    el.addEventListener("wcs-fetch:trigger-changed", (e: Event) => {
      events.push((e as CustomEvent).detail);
    });

    el.trigger = true;
    expect(el.trigger).toBe(true);

    await vi.waitFor(() => {
      expect(el.trigger).toBe(false);
      expect(events).toEqual([false]);
    });
  });

  it("triggerにfalseを設定しても何も起きない", () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    el.setAttribute("manual", "");

    el.trigger = false;

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(el.trigger).toBe(false);
  });

  it("triggerはfetchエラー時でもfalseにリセットされる", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/error");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    const events: boolean[] = [];
    el.addEventListener("wcs-fetch:trigger-changed", (e: Event) => {
      events.push((e as CustomEvent).detail);
    });

    el.trigger = true;

    await vi.waitFor(() => {
      expect(el.trigger).toBe(false);
      expect(events).toEqual([false]);
    });
  });

  it("url未設定でtrigger=trueを設定してもfetchは呼ばれず未捕捉rejectionも発生しない", async () => {
    const unhandled: PromiseRejectionEvent[] = [];
    const onUnhandled = (e: PromiseRejectionEvent): void => {
      e.preventDefault();
      unhandled.push(e);
    };
    globalThis.addEventListener("unhandledrejection", onUnhandled);
    try {
      // url属性なし（urlゲッターは ""）のmanual要素
      const el = document.createElement("wcs-fetch") as Fetch;
      el.setAttribute("manual", "");
      document.body.appendChild(el);

      const events: boolean[] = [];
      el.addEventListener("wcs-fetch:trigger-changed", (e: Event) => {
        events.push((e as CustomEvent).detail);
      });

      el.trigger = true;

      // _triggerはfalseのまま（スタックしない）／イベントは発火しない
      expect(el.trigger).toBe(false);

      // マイクロタスク/マクロタスクを消化して、漏れたrejectionがあれば捕捉する
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(events).toEqual([]);
      expect(unhandled).toHaveLength(0);
    } finally {
      globalThis.removeEventListener("unhandledrejection", onUnhandled);
    }
  });

  it("url未設定スキップ後にurlを設定するとtrigger=trueで実行できる", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ recovered: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    // url空のままtrigger=true（スキップされ_triggerはfalseのまま）
    el.trigger = true;
    expect(el.trigger).toBe(false);

    // urlを設定して再度trigger=true（false→trueの正当な遷移）
    el.setAttribute("url", "/api/recovered");
    el.trigger = true;

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(el.value).toEqual({ recovered: true });
      expect(el.trigger).toBe(false);
    });
  });

  it("name属性が空のヘッダは無視される", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");

    const header = document.createElement("wcs-fetch-header") as FetchHeader;
    // name属性を設定しない
    header.setAttribute("value", "some-value");
    el.appendChild(header);

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).headers).toEqual({});
  });
});

describe("InfiniteScroll", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let observers: MockIntersectionObserver[];

  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    readonly thresholds: ReadonlyArray<number>;
    observedElement: Element | null = null;
    observe = vi.fn((element: Element) => {
      this.observedElement = element;
    });
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn((): IntersectionObserverEntry[] => []);

    constructor(
      private readonly callback: IntersectionObserverCallback,
      options: IntersectionObserverInit = {}
    ) {
      this.root = options.root ?? null;
      this.rootMargin = options.rootMargin ?? "0px";
      const threshold = options.threshold ?? 0;
      this.thresholds = Array.isArray(threshold) ? threshold : [threshold];
      observers.push(this);
    }

    trigger(isIntersecting: boolean): void {
      this.callback([{
        isIntersecting,
        target: this.observedElement,
      } as IntersectionObserverEntry], this);
    }
  }

  beforeEach(() => {
    observers = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue(createMockResponse({ page: true }));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    fetchSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("各setterが対応する属性へ反映される", () => {
    const scrollEl = document.createElement("wcs-infinite-scroll") as InfiniteScroll;

    scrollEl.target = "page-fetch";
    scrollEl.root = "scroll-root";
    scrollEl.rootMargin = "240px 0px";
    scrollEl.threshold = 0.5;
    scrollEl.disabled = true;
    scrollEl.once = true;

    expect(scrollEl.getAttribute("target")).toBe("page-fetch");
    expect(scrollEl.getAttribute("root")).toBe("scroll-root");
    expect(scrollEl.getAttribute("root-margin")).toBe("240px 0px");
    expect(scrollEl.getAttribute("threshold")).toBe("0.5");
    expect(scrollEl.hasAttribute("disabled")).toBe(true);
    expect(scrollEl.hasAttribute("once")).toBe(true);

    scrollEl.root = null;
    scrollEl.disabled = false;
    scrollEl.once = false;

    expect(scrollEl.getAttribute("root")).toBeNull();
    expect(scrollEl.hasAttribute("disabled")).toBe(false);
    expect(scrollEl.hasAttribute("once")).toBe(false);
  });

  it("デフォルトgetterは未設定属性に対応する既定値を返す", () => {
    const scrollEl = document.createElement("wcs-infinite-scroll") as InfiniteScroll;

    expect(scrollEl.target).toBe("");
    expect(scrollEl.root).toBeNull();
    expect(scrollEl.rootMargin).toBe("0px");
    expect(scrollEl.threshold).toBe(0);
    expect(scrollEl.disabled).toBe(false);
    expect(scrollEl.once).toBe(false);
  });

  it("threshold属性がNaNなら0にフォールバックする", () => {
    const scrollEl = document.createElement("wcs-infinite-scroll") as InfiniteScroll;
    scrollEl.setAttribute("threshold", "not-a-number");

    expect(scrollEl.threshold).toBe(0);
  });

  it("交差時にtargetのfetch()を実行する", async () => {
    const fetchEl = document.createElement("wcs-fetch") as Fetch;
    fetchEl.id = "page-fetch";
    fetchEl.setAttribute("url", "/api/page/2");
    fetchEl.setAttribute("manual", "");
    document.body.appendChild(fetchEl);

    const scrollEl = document.createElement("wcs-infinite-scroll") as InfiniteScroll;
    scrollEl.setAttribute("target", "page-fetch");
    document.body.appendChild(scrollEl);

    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledWith(scrollEl);

    observers[0].trigger(true);

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith("/api/page/2", expect.any(Object));
    });
  });

  it("root指定時は対応する要素をobserver.rootに渡す", () => {
    const rootEl = document.createElement("div");
    rootEl.id = "scroll-root";
    document.body.appendChild(rootEl);

    const scrollEl = document.createElement("wcs-infinite-scroll") as InfiniteScroll;
    scrollEl.setAttribute("target", "page-fetch");
    scrollEl.setAttribute("root", "scroll-root");
    document.body.appendChild(scrollEl);

    expect(observers).toHaveLength(1);
    expect(observers[0].root).toBe(rootEl);
  });

  it("未交差時はfetch()を実行しない", () => {
    const fetchEl = document.createElement("wcs-fetch") as Fetch;
    fetchEl.id = "page-fetch";
    fetchEl.setAttribute("url", "/api/page/2");
    fetchEl.setAttribute("manual", "");
    document.body.appendChild(fetchEl);

    const scrollEl = document.createElement("wcs-infinite-scroll") as InfiniteScroll;
    scrollEl.setAttribute("target", "page-fetch");
    document.body.appendChild(scrollEl);

    observers[0].trigger(false);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("targetが存在しない場合は何もしない", () => {
    const scrollEl = document.createElement("wcs-infinite-scroll") as InfiniteScroll;
    scrollEl.setAttribute("target", "missing-fetch");
    document.body.appendChild(scrollEl);

    observers[0].trigger(true);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("targetがFetchでない場合は何もしない", () => {
    const div = document.createElement("div");
    div.id = "not-fetch";
    document.body.appendChild(div);

    const scrollEl = document.createElement("wcs-infinite-scroll") as InfiniteScroll;
    scrollEl.setAttribute("target", "not-fetch");
    document.body.appendChild(scrollEl);

    observers[0].trigger(true);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("url未設定のtargetでも未捕捉rejectionを発生させない", async () => {
    const unhandled: PromiseRejectionEvent[] = [];
    const onUnhandled = (e: PromiseRejectionEvent): void => {
      e.preventDefault();
      unhandled.push(e);
    };
    globalThis.addEventListener("unhandledrejection", onUnhandled);

    try {
      const fetchEl = document.createElement("wcs-fetch") as Fetch;
      fetchEl.id = "page-fetch";
      fetchEl.setAttribute("manual", "");
      document.body.appendChild(fetchEl);

      const scrollEl = document.createElement("wcs-infinite-scroll") as InfiniteScroll;
      scrollEl.setAttribute("target", "page-fetch");
      document.body.appendChild(scrollEl);

      observers[0].trigger(true);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(unhandled).toHaveLength(0);
      expect(fetchEl.trigger).toBe(false);
    } finally {
      globalThis.removeEventListener("unhandledrejection", onUnhandled);
    }
  });

  it("targetがloading中なら重複起動しない", () => {
    const fetchEl = document.createElement("wcs-fetch") as Fetch;
    fetchEl.id = "page-fetch";
    fetchEl.setAttribute("url", "/api/page/2");
    fetchEl.setAttribute("manual", "");
    document.body.appendChild(fetchEl);

    const scrollEl = document.createElement("wcs-infinite-scroll") as InfiniteScroll;
    scrollEl.setAttribute("target", "page-fetch");
    document.body.appendChild(scrollEl);

    Object.defineProperty(fetchEl, "loading", {
      configurable: true,
      get: () => true,
    });

    observers[0].trigger(true);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("disabled属性がある場合は監視しない", () => {
    const scrollEl = document.createElement("wcs-infinite-scroll") as InfiniteScroll;
    scrollEl.setAttribute("target", "page-fetch");
    scrollEl.setAttribute("disabled", "");
    document.body.appendChild(scrollEl);

    expect(observers).toHaveLength(0);
  });

  it("接続後の属性変更でobserverを張り直す", () => {
    const scrollEl = document.createElement("wcs-infinite-scroll") as InfiniteScroll;
    scrollEl.setAttribute("target", "page-fetch");
    document.body.appendChild(scrollEl);

    const firstObserver = observers[0];
    scrollEl.setAttribute("root-margin", "120px 0px");

    expect(firstObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(observers).toHaveLength(2);
    expect(observers[1].rootMargin).toBe("120px 0px");
  });

  it("disabledを外すとobserverを再作成する", () => {
    const scrollEl = document.createElement("wcs-infinite-scroll") as InfiniteScroll;
    scrollEl.setAttribute("target", "page-fetch");
    scrollEl.setAttribute("disabled", "");
    document.body.appendChild(scrollEl);

    expect(observers).toHaveLength(0);

    scrollEl.disabled = false;

    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledWith(scrollEl);
  });

  it("once属性がある場合は1回実行後に監視を解除する", async () => {
    const fetchEl = document.createElement("wcs-fetch") as Fetch;
    fetchEl.id = "page-fetch";
    fetchEl.setAttribute("url", "/api/page/2");
    fetchEl.setAttribute("manual", "");
    document.body.appendChild(fetchEl);

    const scrollEl = document.createElement("wcs-infinite-scroll") as InfiniteScroll;
    scrollEl.setAttribute("target", "page-fetch");
    scrollEl.setAttribute("once", "");
    document.body.appendChild(scrollEl);

    observers[0].trigger(true);

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    });
  });

  it("once発火後は属性変更しても再observeしない", async () => {
    const fetchEl = document.createElement("wcs-fetch") as Fetch;
    fetchEl.id = "page-fetch";
    fetchEl.setAttribute("url", "/api/page/2");
    fetchEl.setAttribute("manual", "");
    document.body.appendChild(fetchEl);

    const scrollEl = document.createElement("wcs-infinite-scroll") as InfiniteScroll;
    scrollEl.setAttribute("target", "page-fetch");
    scrollEl.setAttribute("once", "");
    document.body.appendChild(scrollEl);

    observers[0].trigger(true);

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    scrollEl.setAttribute("root-margin", "160px 0px");

    expect(observers).toHaveLength(1);
  });
});

describe("autoTrigger", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setConfig({ autoTrigger: true });
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue(createMockResponse({ ok: true }));
  });

  afterEach(() => {
    // Detach elements (aborting in-flight requests) before restoring the spy,
    // so no fire-and-forget fetch reaches the real network after mockRestore().
    document.body.innerHTML = "";
    fetchSpy.mockRestore();
    unregisterAutoTrigger();
  });

  it("data-fetchtarget属性を持つ要素のクリックでfetchが実行される", async () => {
    registerAutoTrigger();

    const el = document.createElement("wcs-fetch") as Fetch;
    el.id = "my-fetch";
    el.setAttribute("url", "/api/test");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    const button = document.createElement("button");
    button.setAttribute("data-fetchtarget", "my-fetch");
    document.body.appendChild(button);

    button.click();

    // fetchが呼ばれるのを待つ
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("対象のidの要素がwcs-fetchでない場合は何もしない", () => {
    registerAutoTrigger();

    const div = document.createElement("div");
    div.id = "not-a-fetch";
    document.body.appendChild(div);

    const button = document.createElement("button");
    button.setAttribute("data-fetchtarget", "not-a-fetch");
    document.body.appendChild(button);

    button.click();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("対象のwcs-fetch要素が存在しない場合は何もしない", () => {
    registerAutoTrigger();

    const button = document.createElement("button");
    button.setAttribute("data-fetchtarget", "nonexistent");
    document.body.appendChild(button);

    button.click();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("event.targetがElement以外の場合は何もしない", () => {
    registerAutoTrigger();

    // targetがnullのイベントを手動発火
    const event = new Event("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: null });
    document.dispatchEvent(event);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("data-fetchtarget属性がない要素のクリックでは何もしない", () => {
    registerAutoTrigger();

    const button = document.createElement("button");
    document.body.appendChild(button);

    button.click();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("registerAutoTriggerを2回呼んでも二重登録されない", async () => {
    registerAutoTrigger();
    registerAutoTrigger();

    const el = document.createElement("wcs-fetch") as Fetch;
    el.id = "my-fetch";
    el.setAttribute("url", "/api/test");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    const button = document.createElement("button");
    button.setAttribute("data-fetchtarget", "my-fetch");
    document.body.appendChild(button);

    button.click();

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("unregisterAutoTrigger後はイベントが発火しない", () => {
    registerAutoTrigger();
    unregisterAutoTrigger();
    setConfig({ autoTrigger: false });

    const el = document.createElement("wcs-fetch") as Fetch;
    el.id = "my-fetch";
    el.setAttribute("url", "/api/test");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    const button = document.createElement("button");
    button.setAttribute("data-fetchtarget", "my-fetch");
    document.body.appendChild(button);

    button.click();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("unregisterAutoTriggerを未登録時に呼んでもエラーにならない", () => {
    expect(() => unregisterAutoTrigger()).not.toThrow();
  });

  it("data-fetchtarget属性の値が空の場合は何もしない", () => {
    registerAutoTrigger();

    const button = document.createElement("button");
    button.setAttribute("data-fetchtarget", "");
    document.body.appendChild(button);

    button.click();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("子要素のクリックでも親のdata-fetchtargetを検出する", async () => {
    registerAutoTrigger();

    const el = document.createElement("wcs-fetch") as Fetch;
    el.id = "my-fetch";
    el.setAttribute("url", "/api/test");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    const button = document.createElement("button");
    button.setAttribute("data-fetchtarget", "my-fetch");
    const span = document.createElement("span");
    span.textContent = "Click me";
    button.appendChild(span);
    document.body.appendChild(button);

    span.click();

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("url未設定の対象をクリックしてもfetchは呼ばれず未捕捉rejectionも発生しない", async () => {
    registerAutoTrigger();

    const unhandled: PromiseRejectionEvent[] = [];
    const onUnhandled = (e: PromiseRejectionEvent): void => {
      e.preventDefault();
      unhandled.push(e);
    };
    globalThis.addEventListener("unhandledrejection", onUnhandled);
    try {
      // url属性なし（urlゲッターは ""）の wcs-fetch を対象にする
      const el = document.createElement("wcs-fetch") as Fetch;
      el.id = "no-url-fetch";
      el.setAttribute("manual", "");
      document.body.appendChild(el);

      const button = document.createElement("button");
      button.setAttribute("data-fetchtarget", "no-url-fetch");
      document.body.appendChild(button);

      button.click();

      // マイクロタスク/マクロタスクを消化して、漏れたrejectionがあれば捕捉する
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(unhandled).toHaveLength(0);
    } finally {
      globalThis.removeEventListener("unhandledrejection", onUnhandled);
    }
  });
});

describe("bootstrapFetch", () => {
  afterEach(() => {
    unregisterAutoTrigger();
    setConfig({ autoTrigger: true });
  });

  it("コンポーネントが登録される", () => {
    // 既にテスト冒頭で登録済みなのでdefinedであることを確認
    expect(customElements.get("wcs-fetch")).toBeDefined();
    expect(customElements.get("wcs-fetch-header")).toBeDefined();
    expect(customElements.get("wcs-fetch-body")).toBeDefined();
  });

  it("設定なしでブートストラップできる", () => {
    bootstrapFetch();
    expect(config.autoTrigger).toBe(true);
  });

  it("autoTrigger=trueでブートストラップするとautoTriggerが登録される", () => {
    bootstrapFetch({ autoTrigger: true });
    expect(config.autoTrigger).toBe(true);
  });

  it("autoTrigger=falseでブートストラップするとautoTriggerが登録されない", () => {
    bootstrapFetch({ autoTrigger: false });
    expect(config.autoTrigger).toBe(false);
  });
});

describe("registerComponents", () => {
  it("既に登録済みの場合は再登録しない", () => {
    // 2回呼んでもエラーにならない
    expect(() => registerComponents()).not.toThrow();
  });
});

describe("自動 fetch の microtask coalesce", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  // Flush queued microtasks: the auto-fetch microtask is enqueued first, so a
  // microtask enqueued here resolves after it has run (and called fetch, if any).
  const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue(createMockResponse({ ok: true }));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    fetchSpy.mockRestore();
  });

  it("spread 順序を再現: url を manual より先に同期書き込みしても自動実行されない", async () => {
    // Reproduces the users-crud example (packages/fetch/examples) spread order problem: a `...` spread applies
    // `url` before `manual`. With synchronous fetch this fired a stray request;
    // the coalesced microtask re-reads the final state (manual=true) and skips.
    const el = document.createElement("wcs-fetch") as Fetch;
    document.body.appendChild(el);

    el.setAttribute("url", "/api/users"); // applied first (would auto-fetch)
    el.setAttribute("manual", "");        // applied after, in the same tick

    await flushMicrotasks();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("同一 tick の複数 url 書き込みは 1 回の fetch に集約される", async () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    document.body.appendChild(el);

    el.setAttribute("url", "/api/a");
    el.setAttribute("url", "/api/b");
    el.setAttribute("url", "/api/c");

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    // The final url wins.
    expect(fetchSpy).toHaveBeenLastCalledWith("/api/c", expect.any(Object));
  });

  it("同値 url の再書き込みでは重複 fetch しない（same-value ガード）", async () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/users");
    document.body.appendChild(el);

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    // A spread re-evaluation rewrites the same url (setAttribute fires
    // attributeChangedCallback even for an unchanged value).
    el.setAttribute("url", "/api/users");
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("auto-fetch 失敗後の同値 url 再書き込みは再試行しない（失敗も記録される）", async () => {
    // _lastFetchedUrl is recorded at fetch START, success or failure. Recording
    // only on success would let every spread re-evaluation retry while the
    // endpoint is down — any unrelated state change would hammer it, which is
    // exactly what the guard exists to prevent. Recovery from a transient
    // failure is explicit: url change, remount, or fetch()/trigger/command.
    fetchSpy.mockRejectedValueOnce(new Error("network down"));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/users");
    document.body.appendChild(el);

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    expect(el.error).not.toBeNull();

    // A spread re-evaluation rewrites the same url after the failure.
    el.setAttribute("url", "/api/users");
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no retry

    // An explicit fetch() still works as the recovery path.
    await el.fetch();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("url が別の値に変わると same-value ガードを越えて fetch する", async () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/users");
    document.body.appendChild(el);

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    el.setAttribute("url", "/api/users?role=admin");
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("明示 fetch() は same-value ガードに関係なく実行される", async () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/users");
    document.body.appendChild(el);

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    // Same url, but an explicit call (e.g. a refresh command) must still fire.
    await el.fetch();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("remount（再接続）では same-value ガードがリセットされ再 fetch する", async () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/users");
    document.body.appendChild(el);

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    el.remove();            // disconnect resets _lastFetchedUrl
    document.body.appendChild(el); // reconnect with the same url

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("microtask 待ち中に disconnect されると fetch しない", async () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/users");
    document.body.appendChild(el); // schedules the auto-fetch microtask
    el.remove();                   // disconnect before the microtask runs

    await flushMicrotasks();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("connectedCallbackPromise プロトコル", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  // See the auto-fetch block: the connect-time deferred resolves in every exit
  // path, so these awaits must never hang even when no fetch happens.
  const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    // See the Fetch block for rationale: default resolution prevents stray
    // fire-and-forget fetches from hitting the real network (ECONNREFUSED).
    fetchSpy.mockResolvedValue(createMockResponse({ ok: true }));
  });

  afterEach(() => {
    // Detach before restore so disconnectedCallback aborts requests while the
    // mock is still active.
    document.body.innerHTML = "";
    fetchSpy.mockRestore();
  });

  it("static hasConnectedCallbackPromise が true", () => {
    expect(Fetch.hasConnectedCallbackPromise).toBe(true);
  });

  it("connectedCallbackPromise が初期状態で解決済み Promise を返す", async () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("manual", "");
    const result = await el.connectedCallbackPromise;
    expect(result).toBeUndefined();
  });

  it("auto-fetch 時に connectedCallbackPromise が fetch 完了で解決される", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ data: "test" }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    document.body.appendChild(el);

    await el.connectedCallbackPromise;
    expect(el.value).toEqual({ data: "test" });
    expect(el.loading).toBe(false);
  });

  it("manual 時は connectedCallbackPromise が即座に解決される", async () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    await el.connectedCallbackPromise;
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("promise プロパティが fetch の結果を返す", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ users: [] }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/users");
    el.setAttribute("manual", "");

    el.fetch();
    const result = await el.promise;
    expect(result).toEqual({ users: [] });
  });

  it("connect 時に url があっても直後に manual が立てば、fetch せず promise はハングせず解決する", async () => {
    // connectedCallback arms the deferred (url present, not manual), but `manual`
    // is set synchronously before the microtask runs. The microtask must skip
    // the fetch AND still resolve the armed deferred — otherwise awaiting
    // connectedCallbackPromise would hang forever.
    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    document.body.appendChild(el); // arms deferred + schedules microtask
    el.setAttribute("manual", "");  // applied before the microtask fires

    await Promise.race([
      el.connectedCallbackPromise,
      flushMicrotasks().then(() => flushMicrotasks()),
    ]);
    await el.connectedCallbackPromise; // must already be resolved (no hang)
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("最初の microtask 発火前に同期 remove→append しても、捕捉済みの promise がハングしない", async () => {
    // Leak guard: the first connect arms deferred(resolve1). A synchronous
    // remove()→append() before the scheduled microtask fires re-arms with
    // resolve2. disconnectedCallback must resolve resolve1 first, so a caller
    // that captured the first connectedCallbackPromise never hangs.
    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");

    document.body.appendChild(el);          // arms deferred #1
    const promise1 = el.connectedCallbackPromise;
    el.remove();                            // must resolve deferred #1
    document.body.appendChild(el);          // arms deferred #2

    let settled = false;
    promise1.then(() => { settled = true; });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(settled).toBe(true);
  });
});

describe("wcs-fetch:response はエラー時にも発火する（例の成功ガードの根拠）", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue(createMockResponse({ ok: true }));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    fetchSpy.mockRestore();
  });

  // The users-crud example (packages/fetch/examples) wires `eventToken.value` (= wcs-fetch:response) and
  // must guard on status because this event is NOT success-only. These tests pin
  // that contract so the regression cannot silently return.
  it("HTTP エラー (4xx/5xx) でも wcs-fetch:response が value=null, status=エラーコードで発火する", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ message: "bad" }, { status: 400, ok: false }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/users");
    el.setAttribute("manual", "");

    const responses: Array<{ value: any; status: number }> = [];
    el.addEventListener("wcs-fetch:response", (e) => responses.push((e as CustomEvent).detail));

    await el.fetch();

    expect(responses).toHaveLength(1);
    expect(responses[0].value).toBeNull();
    expect(responses[0].status).toBe(400);
  });

  it("ネットワークエラーでも wcs-fetch:response が value=null, status=0 で発火する", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("network down"));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/users");
    el.setAttribute("manual", "");

    const responses: Array<{ value: any; status: number }> = [];
    el.addEventListener("wcs-fetch:response", (e) => responses.push((e as CustomEvent).detail));

    await el.fetch();

    expect(responses).toHaveLength(1);
    expect(responses[0].value).toBeNull();
    expect(responses[0].status).toBe(0);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Fetch } from "../src/components/Fetch";
import { FetchHeader } from "../src/components/FetchHeader";
import { FetchBody } from "../src/components/FetchBody";
import { bootstrapFetch } from "../src/bootstrapFetch";
import { registerComponents } from "../src/registerComponents";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";
import { config, setConfig, getConfig } from "../src/config";
import { raiseError } from "../src/raiseError";

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

describe("raiseError", () => {
  it("[@wcstack/fetch]プレフィックス付きのエラーをスローする", () => {
    expect(() => raiseError("test error")).toThrow("[@wcstack/fetch] test error");
  });
});

describe("config", () => {
  it("デフォルト設定を取得できる", () => {
    expect(config.tagNames.fetch).toBe("wcs-fetch");
    expect(config.tagNames.fetchHeader).toBe("wcs-fetch-header");
    expect(config.tagNames.fetchBody).toBe("wcs-fetch-body");
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
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    document.body.innerHTML = "";
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
    expect(Fetch.wcBindable.properties).toHaveLength(5);
    expect(Fetch.wcBindable.properties[0].name).toBe("value");
    expect(Fetch.wcBindable.properties[1].name).toBe("loading");
    expect(Fetch.wcBindable.properties[2].name).toBe("error");
    expect(Fetch.wcBindable.properties[3].name).toBe("status");
    expect(Fetch.wcBindable.properties[4].name).toBe("trigger");
    expect(Fetch.wcBindable.properties[4].event).toBe("wcs-fetch:trigger-changed");
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

  it("url未設定時にfetch()を呼ぶとエラーをスローする", async () => {
    const el = document.createElement("wcs-fetch") as Fetch;
    await expect(el.fetch()).rejects.toThrow("[@wcstack/fetch] url attribute is required.");
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

    const result = await el.fetch();

    expect(result).toBeNull();
    expect(el.status).toBe(404);
    expect(errors).toHaveLength(1);
    expect(errors[0].status).toBe(404);
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

  it("GETリクエストではbodyを送信しない", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse({ ok: true }));

    const el = document.createElement("wcs-fetch") as Fetch;
    el.setAttribute("url", "/api/test");
    el.body = { data: "ignored" };

    await el.fetch();

    const [_url, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).body).toBeUndefined();
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

  it("disconnectedCallbackでリクエストがキャンセルされる", async () => {
    fetchSpy.mockImplementationOnce((_url, init) => {
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

describe("autoTrigger", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue(createMockResponse({ ok: true }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    unregisterAutoTrigger();
    document.body.innerHTML = "";
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

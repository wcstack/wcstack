import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UploadCore } from "../src/core/UploadCore";
import { MockXMLHttpRequest, createMockFile } from "./helpers/mockXhr";

describe("UploadCore", () => {
  let originalXHR: typeof XMLHttpRequest;

  beforeEach(() => {
    originalXHR = globalThis.XMLHttpRequest;
    (globalThis as any).XMLHttpRequest = MockXMLHttpRequest;
    MockXMLHttpRequest.resetInstances();
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXHR;
    vi.restoreAllMocks();
  });

  it("EventTargetを継承している", () => {
    const core = new UploadCore();
    expect(core).toBeInstanceOf(EventTarget);
  });

  it("wcBindableプロパティが正しく定義されている", () => {
    expect(UploadCore.wcBindable.protocol).toBe("wc-bindable");
    expect(UploadCore.wcBindable.version).toBe(1);
    expect(UploadCore.wcBindable.properties).toHaveLength(6);
    expect(UploadCore.wcBindable.properties[0].name).toBe("value");
    expect(UploadCore.wcBindable.properties[1].name).toBe("loading");
    expect(UploadCore.wcBindable.properties[2].name).toBe("progress");
    expect(UploadCore.wcBindable.properties[3].name).toBe("error");
    expect(UploadCore.wcBindable.properties[4].name).toBe("status");
    expect(UploadCore.wcBindable.properties[5].name).toBe("errorInfo");
    expect(UploadCore.wcBindable.properties[5].event).toBe("wcs-upload:error-info-changed");
    expect(UploadCore.wcBindable.properties[5].getter).toBeUndefined();
  });

  it("wcBindable inputsがurl/method/fieldNameを宣言している", () => {
    const inputs = UploadCore.wcBindable.inputs!;
    expect(inputs.map((i) => i.name)).toEqual(["url", "method", "fieldName"]);
    // setterが自己反映するため attribute ヒントは持たない（二重設定回避）
    expect(inputs.every((i) => i.attribute === undefined)).toBe(true);
  });

  it("wcBindable commandsがupload(async)/abortを宣言している", () => {
    const commands = UploadCore.wcBindable.commands!;
    expect(commands.map((c) => c.name)).toEqual(["upload", "abort"]);
    expect(commands.find((c) => c.name === "upload")!.async).toBe(true);
    expect(commands.find((c) => c.name === "abort")!.async).toBeUndefined();
  });

  it("wcBindable inputs/commandsのnameがそれぞれ一意である", () => {
    const inputNames = UploadCore.wcBindable.inputs!.map((i) => i.name);
    const commandNames = UploadCore.wcBindable.commands!.map((c) => c.name);
    expect(new Set(inputNames).size).toBe(inputNames.length);
    expect(new Set(commandNames).size).toBe(commandNames.length);
  });

  it("初期状態が正しい", () => {
    const core = new UploadCore();
    expect(core.value).toBeNull();
    expect(core.loading).toBe(false);
    expect(core.progress).toBe(0);
    expect(core.error).toBeNull();
    expect(core.status).toBe(0);
  });

  it("HTMLElementではなくEventTargetベースである", () => {
    const core = new UploadCore();
    expect(core).toBeInstanceOf(EventTarget);
    expect(core).not.toBeInstanceOf(HTMLElement);
  });

  describe("upload", () => {
    it("url未指定時はerrorに流しnullを返す（never-throw）", async () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];
      const r = await core.upload("", files);
      expect(r).toBeNull();
      expect(core.error).toEqual({ message: "url is required." });
    });

    it("ファイル未指定時はerrorに流しnullを返す（never-throw）", async () => {
      const core = new UploadCore();
      const r = await core.upload("/api/upload", []);
      expect(r).toBeNull();
      expect(core.error).toEqual({ message: "files are required." });
    });

    it("ファイルがnull相当の場合はerrorに流しnullを返す（never-throw）", async () => {
      const core = new UploadCore();
      const r = await core.upload("/api/upload", null as any);
      expect(r).toBeNull();
      expect(core.error).toEqual({ message: "files are required." });
    });

    it("ready は解決済み Promise を返す", async () => {
      const core = new UploadCore();
      await expect(core.ready).resolves.toBeUndefined();
    });

    it("observe() は ready を返し、冪等に再呼び出しできる", async () => {
      const core = new UploadCore();
      await expect(core.observe()).resolves.toBeUndefined();
      await expect(core.observe()).resolves.toBeUndefined();
    });

    it("dispose() は進行中アップロードを abort する", () => {
      const core = new UploadCore();
      core.upload("/api/upload", [createMockFile("a.txt", 10, "text/plain")]);
      const xhr = MockXMLHttpRequest.instances.at(-1)!;
      core.dispose();
      expect(xhr.abort).toHaveBeenCalled();
    });

    it("dispose 後に settle した stale load は状態を書かない（_gen ガード）", () => {
      const core = new UploadCore();
      core.upload("/api/upload", [createMockFile("a.txt", 10, "text/plain")]);
      const xhr = MockXMLHttpRequest.instances.at(-1)!;
      core.dispose();
      xhr.simulateLoad(200, '{"x":1}', "application/json");
      expect(core.value).toBeNull();
      expect(core.status).toBe(0);
    });

    it("dispose 後に settle した stale error は状態を書かない（_gen ガード）", () => {
      const core = new UploadCore();
      core.upload("/api/upload", [createMockFile("a.txt", 10, "text/plain")]);
      const xhr = MockXMLHttpRequest.instances.at(-1)!;
      core.dispose();
      xhr.simulateError();
      expect(core.error).toBeNull();
    });

    it("dispose 後に settle した stale abort は loading を変えない（_gen ガード）", () => {
      const core = new UploadCore();
      core.upload("/api/upload", [createMockFile("a.txt", 10, "text/plain")]);
      const xhr = MockXMLHttpRequest.instances.at(-1)!;
      core.dispose();
      xhr.simulateAbort();
      expect(core.loading).toBe(true);
    });

    it("dispose 後の stale progress は progress を書かない（_gen ガード）", () => {
      const core = new UploadCore();
      core.upload("/api/upload", [createMockFile("a.txt", 10, "text/plain")]);
      const xhr = MockXMLHttpRequest.instances.at(-1)!;
      core.dispose();
      xhr.simulateProgress(50, 100);
      expect(core.progress).toBe(0);
    });

    it("FormDataを構築してXHRで送信する", () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];
      core.upload("/api/upload", files);

      expect(MockXMLHttpRequest.instances).toHaveLength(1);
      const xhr = MockXMLHttpRequest.instances[0];
      expect(xhr.open).toHaveBeenCalledWith("POST", "/api/upload");
      expect(xhr.send).toHaveBeenCalledTimes(1);

      // FormDataが送信されている
      const sentData = xhr.send.mock.calls[0][0];
      expect(sentData).toBeInstanceOf(FormData);
    });

    it("カスタムメソッドを指定できる", () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];
      core.upload("/api/upload", files, { method: "PUT" });

      const xhr = MockXMLHttpRequest.instances[0];
      expect(xhr.open).toHaveBeenCalledWith("PUT", "/api/upload");
    });

    it("カスタムヘッダーを設定できる", () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];
      core.upload("/api/upload", files, {
        headers: { "Authorization": "Bearer token123" },
      });

      const xhr = MockXMLHttpRequest.instances[0];
      expect(xhr.setRequestHeader).toHaveBeenCalledWith("Authorization", "Bearer token123");
    });

    it("カスタムフィールド名を指定できる", () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];
      core.upload("/api/upload", files, { fieldName: "attachment" });

      const xhr = MockXMLHttpRequest.instances[0];
      const sentData = xhr.send.mock.calls[0][0] as FormData;
      expect(sentData.getAll("attachment")).toHaveLength(1);
    });

    it("複数ファイルをFormDataに追加する", () => {
      const core = new UploadCore();
      const files = [
        createMockFile("file1.txt", 100, "text/plain"),
        createMockFile("file2.txt", 200, "text/plain"),
      ];
      core.upload("/api/upload", files);

      const xhr = MockXMLHttpRequest.instances[0];
      const sentData = xhr.send.mock.calls[0][0] as FormData;
      expect(sentData.getAll("file")).toHaveLength(2);
    });

    it("アップロード開始時にloadingがtrueになる", () => {
      const core = new UploadCore();
      const events: boolean[] = [];
      core.addEventListener("wcs-upload:loading-changed", (e) => {
        events.push((e as CustomEvent).detail);
      });

      const files = [createMockFile("test.txt", 100, "text/plain")];
      core.upload("/api/upload", files);
      expect(core.loading).toBe(true);
      expect(events).toEqual([true]);
    });

    it("アップロード開始時にprogressが0にリセットされる", () => {
      const core = new UploadCore();
      const events: number[] = [];
      core.addEventListener("wcs-upload:progress", (e) => {
        events.push((e as CustomEvent).detail);
      });

      const files = [createMockFile("test.txt", 100, "text/plain")];
      core.upload("/api/upload", files);
      expect(core.progress).toBe(0);
      expect(events).toEqual([0]);
    });

    it("promiseプロパティを返す", async () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];
      const result = core.upload("/api/upload", files);
      expect(result).toBeInstanceOf(Promise);
      expect(core.promise).toBeInstanceOf(Promise);

      // 進行中の内部 promise が公開される（成功時に同じ値で解決）
      const xhr = MockXMLHttpRequest.instances[0];
      xhr.simulateLoad(200, '{"ok":true}', "application/json");
      await expect(result).resolves.toEqual({ ok: true });
      await expect(core.promise).resolves.toEqual({ ok: true });
    });
  });

  describe("progress", () => {
    it("プログレスイベントを処理する", () => {
      const core = new UploadCore();
      const events: number[] = [];
      core.addEventListener("wcs-upload:progress", (e) => {
        events.push((e as CustomEvent).detail);
      });

      const files = [createMockFile("test.txt", 1000, "text/plain")];
      core.upload("/api/upload", files);

      const xhr = MockXMLHttpRequest.instances[0];
      xhr.simulateProgress(500, 1000);
      expect(core.progress).toBe(50);
      expect(events).toContain(50);

      xhr.simulateProgress(1000, 1000);
      expect(core.progress).toBe(100);
      expect(events).toContain(100);
    });

    it("lengthComputableがfalseの場合はプログレスを更新しない", () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 1000, "text/plain")];
      core.upload("/api/upload", files);

      const xhr = MockXMLHttpRequest.instances[0];
      xhr.simulateProgressUncomputable();
      expect(core.progress).toBe(0);
    });
  });

  describe("成功レスポンス", () => {
    it("JSONレスポンスを自動パースする", async () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];
      const promise = core.upload("/api/upload", files);

      const xhr = MockXMLHttpRequest.instances[0];
      xhr.simulateLoad(200, '{"id":1,"filename":"test.txt"}', "application/json");

      const result = await promise;
      expect(result).toEqual({ id: 1, filename: "test.txt" });
      expect(core.value).toEqual({ id: 1, filename: "test.txt" });
      expect(core.status).toBe(200);
      expect(core.loading).toBe(false);
      expect(core.progress).toBe(100);
    });

    it("テキストレスポンスをそのまま返す", async () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];
      const promise = core.upload("/api/upload", files);

      const xhr = MockXMLHttpRequest.instances[0];
      xhr.simulateLoad(200, "Upload successful", "text/plain");

      const result = await promise;
      expect(result).toBe("Upload successful");
      expect(core.value).toBe("Upload successful");
    });

    it("Content-Type未指定の場合はテキストとして扱う", async () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];
      const promise = core.upload("/api/upload", files);

      const xhr = MockXMLHttpRequest.instances[0];
      xhr.simulateLoad(200, "raw response");

      const result = await promise;
      expect(result).toBe("raw response");
    });

    it("不正なJSONはテキストとして扱う", async () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];
      const promise = core.upload("/api/upload", files);

      const xhr = MockXMLHttpRequest.instances[0];
      xhr.simulateLoad(200, "{invalid json}", "application/json");

      const result = await promise;
      expect(result).toBe("{invalid json}");
    });

    it("responseイベントが発火する", async () => {
      const core = new UploadCore();
      const events: any[] = [];
      core.addEventListener("wcs-upload:response", (e) => {
        events.push((e as CustomEvent).detail);
      });

      const files = [createMockFile("test.txt", 100, "text/plain")];
      const promise = core.upload("/api/upload", files);

      const xhr = MockXMLHttpRequest.instances[0];
      xhr.simulateLoad(200, '{"ok":true}', "application/json");

      await promise;
      expect(events).toHaveLength(1);
      expect(events[0].value).toEqual({ ok: true });
      expect(events[0].status).toBe(200);
    });

    it("wcBindableのgetterが正しく動作する", async () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];
      const promise = core.upload("/api/upload", files);

      const xhr = MockXMLHttpRequest.instances[0];
      xhr.simulateLoad(200, '{"ok":true}', "application/json");

      await promise;

      // value getter
      const valueGetter = UploadCore.wcBindable.properties[0].getter!;
      const mockEvent = new CustomEvent("wcs-upload:response", {
        detail: { value: { ok: true }, status: 200 },
      });
      expect(valueGetter(mockEvent)).toEqual({ ok: true });

      // status getter
      const statusGetter = UploadCore.wcBindable.properties[4].getter!;
      expect(statusGetter(mockEvent)).toBe(200);
    });
  });

  describe("エラーレスポンス", () => {
    it("HTTPエラーを処理する", async () => {
      const core = new UploadCore();
      const errors: any[] = [];
      core.addEventListener("wcs-upload:error", (e) => {
        errors.push((e as CustomEvent).detail);
      });

      const files = [createMockFile("test.txt", 100, "text/plain")];
      const promise = core.upload("/api/upload", files);

      const xhr = MockXMLHttpRequest.instances[0];
      xhr.simulateLoad(413, "File too large");

      const result = await promise;
      expect(result).toBeNull();
      expect(core.error).toEqual({
        status: 413,
        statusText: "Error",
        body: "File too large",
      });
      expect(core.loading).toBe(false);
      // 命令的 getter ではエラーステータスも取得できる（バインド経路は更新されないが
      // getter は生の XHR ステータスを反映する。README「error と response」節参照）。
      expect(core.status).toBe(413);
    });

    it("ネットワークエラーを処理する", async () => {
      const core = new UploadCore();
      const errors: any[] = [];
      core.addEventListener("wcs-upload:error", (e) => {
        errors.push((e as CustomEvent).detail);
      });

      const files = [createMockFile("test.txt", 100, "text/plain")];
      const promise = core.upload("/api/upload", files);

      const xhr = MockXMLHttpRequest.instances[0];
      xhr.simulateError();

      const result = await promise;
      expect(result).toBeNull();
      expect(core.error).toEqual({ message: "Network error" });
      expect(core.loading).toBe(false);
    });

    it("次のアップロード開始時に前回のerrorがクリアされる（FetchCoreと一貫）", async () => {
      const core = new UploadCore();
      const errorEvents: any[] = [];
      core.addEventListener("wcs-upload:error", (e) => {
        errorEvents.push((e as CustomEvent).detail);
      });

      const files = [createMockFile("test.txt", 100, "text/plain")];

      // 1回目: HTTPエラーで error がセットされる
      const promise1 = core.upload("/api/upload", files);
      MockXMLHttpRequest.instances[0].simulateLoad(500, "Server error");
      await promise1;
      expect(core.error).toEqual({ status: 500, statusText: "Error", body: "Server error" });

      // 2回目: 開始時点で error が null にリセットされる（_setError(null)）
      const promise2 = core.upload("/api/upload", files);
      expect(core.error).toBeNull();
      expect(errorEvents[errorEvents.length - 1]).toBeNull();

      // 2回目を成功させても _setResponse は error をクリアしない（開始時クリアに依存）
      MockXMLHttpRequest.instances[1].simulateLoad(200, '{"ok":true}', "application/json");
      await promise2;
      expect(core.error).toBeNull();
    });

    it("error の同値ガード: error が null のままの成功アップロードでは null→null の error イベントは発火しない", async () => {
      const core = new UploadCore();
      const errorEvents: any[] = [];
      core.addEventListener("wcs-upload:error", (e) => {
        errorEvents.push((e as CustomEvent).detail);
      });

      const files = [createMockFile("test.txt", 100, "text/plain")];
      const promise = core.upload("/api/upload", files);
      MockXMLHttpRequest.instances[0].simulateLoad(200, '{"ok":true}', "application/json");
      await promise;

      // 開始時の _setError(null) は同値ガードで抑止される（error は初期値 null のため）
      expect(errorEvents).toEqual([]);
      expect(core.error).toBeNull();
    });
  });

  describe("abort", () => {
    it("アップロードを中断する", async () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];
      const promise = core.upload("/api/upload", files);

      core.abort();
      expect(MockXMLHttpRequest.instances[0].abort).toHaveBeenCalled();

      MockXMLHttpRequest.instances[0].simulateAbort();
      const result = await promise;
      expect(result).toBeNull();
      expect(core.loading).toBe(false);
    });

    it("XHR未生成時のabortはエラーにならない", () => {
      const core = new UploadCore();
      expect(() => core.abort()).not.toThrow();
    });
  });

  describe("target injection", () => {
    it("カスタムターゲットにイベントを発火する", async () => {
      const customTarget = new EventTarget();
      const core = new UploadCore(customTarget);
      const responses: any[] = [];

      customTarget.addEventListener("wcs-upload:response", (e) => {
        responses.push((e as CustomEvent).detail);
      });

      const files = [createMockFile("test.txt", 100, "text/plain")];
      const promise = core.upload("/api/upload", files);

      const xhr = MockXMLHttpRequest.instances[0];
      xhr.simulateLoad(200, '{"ok":true}', "application/json");

      await promise;
      expect(responses).toHaveLength(1);
      expect(responses[0].value).toEqual({ ok: true });
    });
  });

  describe("既存アップロードの中止", () => {
    it("新しいアップロード開始時に既存をabortする", () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];

      core.upload("/api/upload", files);
      const firstXhr = MockXMLHttpRequest.instances[0];

      core.upload("/api/upload", files);
      expect(firstXhr.abort).toHaveBeenCalled();
      expect(MockXMLHttpRequest.instances).toHaveLength(2);
    });
  });

  describe("errorInfo（bindable 出力・wcs-upload:error-info-changed）", () => {
    it("HTTP エラーで errorInfo=http-error が detail 付きで発火し、次の upload 開始時に null で発火する", async () => {
      const core = new UploadCore();
      const details: unknown[] = [];
      core.addEventListener("wcs-upload:error-info-changed", (e) => details.push((e as CustomEvent).detail));
      const files = [createMockFile("a.txt", 1, "text/plain")];

      const p1 = core.upload("/api/1", files);
      MockXMLHttpRequest.instances[0].simulateLoad(500, "boom");
      await p1;
      expect(details).toHaveLength(1);
      expect((details[0] as { code: string }).code).toBe("http-error");
      expect(core.errorInfo?.recoverable).toBe(true);

      const p2 = core.upload("/api/2", files);
      MockXMLHttpRequest.instances[1].simulateLoad(200, "ok");
      await p2;
      expect(details).toHaveLength(2);
      expect(details[1]).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("ネットワークエラーは errorInfo=network", async () => {
      const core = new UploadCore();
      const p = core.upload("/api/1", [createMockFile("a.txt", 1, "text/plain")]);
      MockXMLHttpRequest.instances[0].simulateError();
      await p;
      expect(core.errorInfo).toEqual({ code: "network", phase: "execute", recoverable: true, message: "Network error" });
    });

    it("abort は errorInfo を立てない（失敗ではない）", async () => {
      const core = new UploadCore();
      const p = core.upload("/api/1", [createMockFile("a.txt", 1, "text/plain")]);
      MockXMLHttpRequest.instances[0].simulateAbort();
      await p;
      expect(core.errorInfo).toBeNull();
    });

    it("成功のみでは error-info-changed を発火しない（同値ガード）", async () => {
      const core = new UploadCore();
      const details: unknown[] = [];
      core.addEventListener("wcs-upload:error-info-changed", (e) => details.push((e as CustomEvent).detail));
      const p = core.upload("/api/1", [createMockFile("a.txt", 1, "text/plain")]);
      MockXMLHttpRequest.instances[0].simulateLoad(200, "ok");
      await p;
      expect(details).toHaveLength(0);
      expect(core.errorInfo).toBeNull();
    });

    it("url/files 欠落は invalid-argument", async () => {
      const core = new UploadCore();
      await core.upload("", [createMockFile("a.txt", 1, "text/plain")]);
      expect(core.errorInfo).toEqual({ code: "invalid-argument", phase: "start", recoverable: false, message: "url is required." });
      await core.upload("/api/1", []);
      expect(core.errorInfo).toEqual({ code: "invalid-argument", phase: "start", recoverable: false, message: "files are required." });
    });

    it("イベントは bubbles する", async () => {
      const core = new UploadCore();
      let bubbles = false;
      core.addEventListener("wcs-upload:error-info-changed", (e) => { bubbles = e.bubbles; });
      const p = core.upload("/api/1", [createMockFile("a.txt", 1, "text/plain")]);
      MockXMLHttpRequest.instances[0].simulateError();
      await p;
      expect(bubbles).toBe(true);
    });

    it("XMLHttpRequest があれば supported=true・readiness=ready", () => {
      const core = new UploadCore();
      expect(core.supported).toBe(true);
      expect(core.platformAssessment.readiness).toBe("ready");
      expect(core.platformAssessment.availability.get("web.xhr")).toBe("available");
    });
  });

  describe("capability（XMLHttpRequest 不在）", () => {
    it("XMLHttpRequest 不在時は開始せず capability-missing", async () => {
      const orig = globalThis.XMLHttpRequest;
      (globalThis as any).XMLHttpRequest = undefined;
      try {
        const core = new UploadCore();
        expect(core.supported).toBe(false);
        expect(core.platformAssessment.readiness).toBe("idle");
        const result = await core.upload("/api/1", [createMockFile("a.txt", 1, "text/plain")]);
        expect(result).toBeNull();
        expect(core.errorInfo).toEqual({
          code: "capability-missing", phase: "start", recoverable: false,
          capabilityId: "web.xhr",
          message: 'Required capability "web.xhr" is unavailable.',
        });
        expect(core.error).toEqual({ message: 'Required capability "web.xhr" is unavailable.' });
      } finally {
        globalThis.XMLHttpRequest = orig;
      }
    });
  });

  describe("commit guard（latest の同期 supersede）", () => {
    it("response listener が upload を再入して supersede すると残り commit を止める（guard 後検査）", async () => {
      const core = new UploadCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-upload:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));
      let superseded = false;
      core.addEventListener("wcs-upload:response", () => {
        if (!superseded) {
          superseded = true;
          core.upload("/api/2", [createMockFile("b.txt", 1, "text/plain")]); // op1 の setResponse 途中で supersede
        }
      });

      const p1 = core.upload("/api/1", [createMockFile("a.txt", 1, "text/plain")]);
      MockXMLHttpRequest.instances[0].simulateLoad(200, "ok1");
      await p1;
      MockXMLHttpRequest.instances[1].simulateLoad(200, "ok2");
      await new Promise((r) => setTimeout(r, 0));

      expect(core.value).toBe("ok2"); // op2 が勝つ
      // op1 の setLoading(false) は guard で抑止される（無ければ op1 の false が余分に挟まる）。
      expect(loadingEvents).toEqual([true, true, false]);
    });

    it("dispose 後に HTTP エラーで load した stale な upload は状態を書かない（http-error stale）", async () => {
      const core = new UploadCore();
      const errors: any[] = [];
      core.addEventListener("wcs-upload:error", (e) => errors.push((e as CustomEvent).detail));
      const p = core.upload("/api/1", [createMockFile("a.txt", 1, "text/plain")]);
      const xhr = MockXMLHttpRequest.instances[0];
      core.dispose();                 // owner generation を進めて stale 化
      xhr.simulateLoad(500, "boom");  // stale な HTTP エラー(terminal CAS が失敗する)
      const result = await p;
      expect(result).toBeNull();
      expect(core.error).toBeNull();  // stale なので error は書かれない
      expect(errors).toEqual([]);
    });
  });
});

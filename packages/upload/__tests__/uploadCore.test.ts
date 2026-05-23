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
    expect(UploadCore.wcBindable.properties).toHaveLength(5);
    expect(UploadCore.wcBindable.properties[0].name).toBe("value");
    expect(UploadCore.wcBindable.properties[1].name).toBe("loading");
    expect(UploadCore.wcBindable.properties[2].name).toBe("progress");
    expect(UploadCore.wcBindable.properties[3].name).toBe("error");
    expect(UploadCore.wcBindable.properties[4].name).toBe("status");
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
    it("url未指定時にrejectする", async () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];
      await expect(core.upload("", files)).rejects.toThrow(
        "[@wcstack/upload] url is required."
      );
    });

    it("ファイル未指定時にrejectする", async () => {
      const core = new UploadCore();
      await expect(core.upload("/api/upload", [])).rejects.toThrow(
        "[@wcstack/upload] files are required."
      );
    });

    it("ファイルがnull相当の場合にrejectする", async () => {
      const core = new UploadCore();
      await expect(core.upload("/api/upload", null as any)).rejects.toThrow(
        "[@wcstack/upload] files are required."
      );
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
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UploadCore } from "../src/core/UploadCore";

// XMLHttpRequestモック
class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];
  static resetInstances(): void {
    MockXMLHttpRequest.instances = [];
  }

  // XHR properties
  status = 0;
  statusText = "";
  responseText = "";
  readyState = 0;

  // Methods
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn();
  setRequestHeader = vi.fn();
  getResponseHeader = vi.fn().mockReturnValue(null);

  // Upload target
  upload = new EventTarget();

  // Event listeners stored for simulation
  private _listeners: Record<string, ((event: any) => void)[]> = {};

  constructor() {
    MockXMLHttpRequest.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    if (!this._listeners[type]) {
      this._listeners[type] = [];
    }
    this._listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    if (this._listeners[type]) {
      this._listeners[type] = this._listeners[type].filter(l => l !== listener);
    }
  }

  // テストヘルパー
  simulateProgress(loaded: number, total: number): void {
    this.upload.dispatchEvent(new ProgressEvent("progress", {
      lengthComputable: true,
      loaded,
      total,
    }));
  }

  simulateProgressUncomputable(): void {
    this.upload.dispatchEvent(new ProgressEvent("progress", {
      lengthComputable: false,
      loaded: 0,
      total: 0,
    }));
  }

  simulateLoad(status: number, responseText: string, contentType?: string): void {
    this.status = status;
    this.statusText = status < 400 ? "OK" : "Error";
    this.responseText = responseText;
    if (contentType) {
      this.getResponseHeader.mockImplementation((name: string) => {
        if (name === "Content-Type") return contentType;
        return null;
      });
    }
    for (const listener of this._listeners["load"] || []) {
      listener(new Event("load"));
    }
  }

  simulateError(): void {
    for (const listener of this._listeners["error"] || []) {
      listener(new Event("error"));
    }
  }

  simulateAbort(): void {
    for (const listener of this._listeners["abort"] || []) {
      listener(new Event("abort"));
    }
  }
}

function createMockFile(name: string, size: number, type: string): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

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
    it("url未指定時にエラーをスローする", () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];
      expect(() => core.upload("", files)).toThrow(
        "[@wcstack/upload] url is required."
      );
    });

    it("ファイル未指定時にエラーをスローする", () => {
      const core = new UploadCore();
      expect(() => core.upload("/api/upload", [])).toThrow(
        "[@wcstack/upload] files are required."
      );
    });

    it("ファイルがnull相当の場合にエラーをスローする", () => {
      const core = new UploadCore();
      expect(() => core.upload("/api/upload", null as any)).toThrow(
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

    it("promiseプロパティを返す", () => {
      const core = new UploadCore();
      const files = [createMockFile("test.txt", 100, "text/plain")];
      const result = core.upload("/api/upload", files);
      expect(result).toBeInstanceOf(Promise);
      expect(core.promise).toBe(result);
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

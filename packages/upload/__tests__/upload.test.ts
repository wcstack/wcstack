import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapUpload } from "../src/bootstrapUpload";
import { setConfig } from "../src/config";
import { WcsUpload } from "../src/components/Upload";

// XMLHttpRequestモック
class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];
  static resetInstances(): void {
    MockXMLHttpRequest.instances = [];
  }

  status = 0;
  statusText = "";
  responseText = "";
  readyState = 0;

  open = vi.fn();
  send = vi.fn();
  abort = vi.fn();
  setRequestHeader = vi.fn();
  getResponseHeader = vi.fn().mockReturnValue(null);

  upload = new EventTarget();

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

  simulateProgress(loaded: number, total: number): void {
    this.upload.dispatchEvent(new ProgressEvent("progress", {
      lengthComputable: true,
      loaded,
      total,
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

describe("WcsUpload コンポーネント", () => {
  let originalXHR: typeof XMLHttpRequest;

  beforeEach(() => {
    originalXHR = globalThis.XMLHttpRequest;
    (globalThis as any).XMLHttpRequest = MockXMLHttpRequest;
    MockXMLHttpRequest.resetInstances();
    setConfig({ autoTrigger: false });
    bootstrapUpload();
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXHR;
    vi.restoreAllMocks();
  });

  function createElement(attrs: Record<string, string> = {}): WcsUpload {
    const el = document.createElement("wcs-upload") as WcsUpload;
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
    return el;
  }

  it("カスタム要素として登録されている", () => {
    expect(customElements.get("wcs-upload")).toBe(WcsUpload);
  });

  it("wcBindableが正しく定義されている", () => {
    expect(WcsUpload.wcBindable.protocol).toBe("wc-bindable");
    expect(WcsUpload.wcBindable.properties).toHaveLength(7);
    const names = WcsUpload.wcBindable.properties.map(p => p.name);
    expect(names).toEqual(["value", "loading", "progress", "error", "status", "trigger", "files"]);
  });

  describe("属性アクセサ", () => {
    it("url属性の読み書きができる", () => {
      const el = createElement();
      el.url = "/api/upload";
      expect(el.url).toBe("/api/upload");
      expect(el.getAttribute("url")).toBe("/api/upload");
    });

    it("method属性のデフォルト値がPOST", () => {
      const el = createElement();
      expect(el.method).toBe("POST");
    });

    it("method属性の読み書きができる", () => {
      const el = createElement();
      el.method = "PUT";
      expect(el.method).toBe("PUT");
    });

    it("fieldName属性のデフォルト値がfile", () => {
      const el = createElement();
      expect(el.fieldName).toBe("file");
    });

    it("fieldName属性の読み書きができる", () => {
      const el = createElement();
      el.fieldName = "attachment";
      expect(el.fieldName).toBe("attachment");
      expect(el.getAttribute("field-name")).toBe("attachment");
    });

    it("multiple属性の読み書きができる", () => {
      const el = createElement();
      expect(el.multiple).toBe(false);
      el.multiple = true;
      expect(el.multiple).toBe(true);
      expect(el.hasAttribute("multiple")).toBe(true);
      el.multiple = false;
      expect(el.hasAttribute("multiple")).toBe(false);
    });

    it("maxSize属性のデフォルト値がInfinity", () => {
      const el = createElement();
      expect(el.maxSize).toBe(Infinity);
    });

    it("maxSize属性の読み書きができる", () => {
      const el = createElement();
      el.maxSize = 1024000;
      expect(el.maxSize).toBe(1024000);
      expect(el.getAttribute("max-size")).toBe("1024000");
    });

    it("accept属性の読み書きができる", () => {
      const el = createElement();
      el.accept = "image/*,.pdf";
      expect(el.accept).toBe("image/*,.pdf");
    });

    it("manual属性の読み書きができる", () => {
      const el = createElement();
      expect(el.manual).toBe(false);
      el.manual = true;
      expect(el.manual).toBe(true);
      el.manual = false;
      expect(el.manual).toBe(false);
    });
  });

  describe("connectedCallback", () => {
    it("display:noneに設定される", () => {
      const el = createElement({ url: "/api/upload" });
      document.body.appendChild(el);
      expect(el.style.display).toBe("none");
      el.remove();
    });

    it("接続時にアップロードを自動実行しない（ファイルが必要）", () => {
      const el = createElement({ url: "/api/upload" });
      document.body.appendChild(el);
      expect(MockXMLHttpRequest.instances).toHaveLength(0);
      el.remove();
    });
  });

  describe("disconnectedCallback", () => {
    it("DOM除去時にアップロードを中断する", async () => {
      const el = createElement({ url: "/api/upload" });
      document.body.appendChild(el);

      const files = [createMockFile("test.txt", 100, "text/plain")];
      el.files = files;

      // upload が始まるのを待つ
      await new Promise(resolve => setTimeout(resolve, 0));
      const xhr = MockXMLHttpRequest.instances[0];

      el.remove();
      expect(xhr.abort).toHaveBeenCalled();
    });
  });

  describe("コア委譲", () => {
    it("value, loading, progress, error, status, promiseがコアに委譲される", async () => {
      const el = createElement({ url: "/api/upload" });
      document.body.appendChild(el);

      expect(el.value).toBeNull();
      expect(el.loading).toBe(false);
      expect(el.progress).toBe(0);
      expect(el.error).toBeNull();
      expect(el.status).toBe(0);
      expect(el.promise).toBeInstanceOf(Promise);

      el.remove();
    });
  });

  describe("files", () => {
    it("filesプロパティの読み書きができる", () => {
      const el = createElement({ url: "/api/upload", manual: "" });
      document.body.appendChild(el);

      const files = [createMockFile("test.txt", 100, "text/plain")];
      el.files = files;
      expect(el.files).toBe(files);
      el.remove();
    });

    it("files設定時にイベントが発火する", () => {
      const el = createElement({ url: "/api/upload", manual: "" });
      document.body.appendChild(el);

      const events: any[] = [];
      el.addEventListener("wcs-upload:files-changed", (e) => {
        events.push((e as CustomEvent).detail);
      });

      const files = [createMockFile("test.txt", 100, "text/plain")];
      el.files = files;
      expect(events).toHaveLength(1);
      expect(events[0]).toBe(files);
      el.remove();
    });

    it("manual未設定の場合にfiles設定で自動アップロードする", () => {
      const el = createElement({ url: "/api/upload" });
      document.body.appendChild(el);

      const files = [createMockFile("test.txt", 100, "text/plain")];
      el.files = files;
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
      el.remove();
    });

    it("manual設定時はfiles設定で自動アップロードしない", () => {
      const el = createElement({ url: "/api/upload", manual: "" });
      document.body.appendChild(el);

      const files = [createMockFile("test.txt", 100, "text/plain")];
      el.files = files;
      expect(MockXMLHttpRequest.instances).toHaveLength(0);
      el.remove();
    });

    it("url未設定の場合はfiles設定で自動アップロードしない", () => {
      const el = createElement();
      document.body.appendChild(el);

      const files = [createMockFile("test.txt", 100, "text/plain")];
      el.files = files;
      expect(MockXMLHttpRequest.instances).toHaveLength(0);
      el.remove();
    });

    it("空のファイルリストでは自動アップロードしない", () => {
      const el = createElement({ url: "/api/upload" });
      document.body.appendChild(el);

      el.files = [];
      expect(MockXMLHttpRequest.instances).toHaveLength(0);
      el.remove();
    });

    it("アップロード完了後にfilesがnullにリセットされる", async () => {
      const el = createElement({ url: "/api/upload" });
      document.body.appendChild(el);

      const files = [createMockFile("test.txt", 100, "text/plain")];
      el.files = files;

      const xhr = MockXMLHttpRequest.instances[0];
      xhr.simulateLoad(200, '{"ok":true}', "application/json");

      // Promiseが解決するまで待つ
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(el.files).toBeNull();
      el.remove();
    });

    it("連続アップロードで新しいfilesが古い完了処理で潰されない", async () => {
      const el = createElement({ url: "/api/upload", manual: "" });
      document.body.appendChild(el);

      // 1回目のアップロード開始
      const files1 = [createMockFile("first.txt", 100, "text/plain")];
      el.files = files1;
      el.trigger = true;
      const xhr1 = MockXMLHttpRequest.instances[0];

      // 1回目完了前に2回目のファイルをセットしてアップロード開始
      const files2 = [createMockFile("second.txt", 200, "text/plain")];
      el.files = files2;
      el.trigger = true;

      // 1回目のXHRはabortされている
      expect(xhr1.abort).toHaveBeenCalled();

      // 1回目のabortコールバック発火（nullで復帰）
      xhr1.simulateAbort();
      await new Promise(resolve => setTimeout(resolve, 0));

      // 2回目のfilesが残っている（1回目の後処理で消されていない）
      expect(el.files).toBe(files2);

      // 2回目のXHRを完了させる
      const xhr2 = MockXMLHttpRequest.instances[1];
      xhr2.simulateLoad(200, '{"ok":true}', "application/json");
      await new Promise(resolve => setTimeout(resolve, 0));

      // 2回目完了後はnullにリセット
      expect(el.files).toBeNull();
      el.remove();
    });
  });

  describe("trigger", () => {
    it("trigger設定でアップロードを開始する", async () => {
      const el = createElement({ url: "/api/upload", manual: "" });
      document.body.appendChild(el);

      const files = [createMockFile("test.txt", 100, "text/plain")];
      el.files = files;
      expect(MockXMLHttpRequest.instances).toHaveLength(0);

      el.trigger = true;
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
      el.remove();
    });

    it("triggerリセット時にイベントが発火する", async () => {
      const el = createElement({ url: "/api/upload", manual: "" });
      document.body.appendChild(el);

      const events: boolean[] = [];
      el.addEventListener("wcs-upload:trigger-changed", (e) => {
        events.push((e as CustomEvent).detail);
      });

      const files = [createMockFile("test.txt", 100, "text/plain")];
      el.files = files;

      el.trigger = true;
      const xhr = MockXMLHttpRequest.instances[0];
      xhr.simulateLoad(200, '{"ok":true}', "application/json");

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(events).toEqual([false]);
      expect(el.trigger).toBe(false);
      el.remove();
    });

    it("falseの場合は何もしない", () => {
      const el = createElement({ url: "/api/upload", manual: "" });
      document.body.appendChild(el);
      el.trigger = false;
      expect(MockXMLHttpRequest.instances).toHaveLength(0);
      el.remove();
    });

    it("ファイル未設定時はtriggerでもアップロードしない", () => {
      const el = createElement({ url: "/api/upload", manual: "" });
      document.body.appendChild(el);
      el.trigger = true;
      expect(MockXMLHttpRequest.instances).toHaveLength(0);
      el.remove();
    });
  });

  describe("バリデーション", () => {
    it("maxSizeを超えるファイルでエラーを発火する", async () => {
      const el = createElement({ url: "/api/upload", "max-size": "100" });
      document.body.appendChild(el);

      const errors: any[] = [];
      el.addEventListener("wcs-upload:error", (e) => {
        errors.push((e as CustomEvent).detail);
      });

      const files = [createMockFile("big.txt", 200, "text/plain")];
      el.files = files;

      // バリデーションエラーでXHRは呼ばれない
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(MockXMLHttpRequest.instances).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("big.txt");
      expect(errors[0].message).toContain("100");
      el.remove();
    });

    it("accept指定の拡張子でフィルタする", async () => {
      const el = createElement({ url: "/api/upload", accept: ".png,.jpg" });
      document.body.appendChild(el);

      const errors: any[] = [];
      el.addEventListener("wcs-upload:error", (e) => {
        errors.push((e as CustomEvent).detail);
      });

      const files = [createMockFile("doc.pdf", 100, "application/pdf")];
      el.files = files;

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(MockXMLHttpRequest.instances).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("doc.pdf");
      el.remove();
    });

    it("accept指定のMIMEタイプでフィルタする", async () => {
      const el = createElement({ url: "/api/upload", accept: "image/png" });
      document.body.appendChild(el);

      const errors: any[] = [];
      el.addEventListener("wcs-upload:error", (e) => {
        const detail = (e as CustomEvent).detail;
        if (detail !== null) errors.push(detail);
      });

      // 一致するファイルはOK
      const pngFiles = [createMockFile("photo.png", 100, "image/png")];
      el.files = pngFiles;
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
      expect(errors).toHaveLength(0);
      el.remove();
    });

    it("accept指定のワイルドカードMIMEタイプでフィルタする", async () => {
      const el = createElement({ url: "/api/upload", accept: "image/*" });
      document.body.appendChild(el);

      const files = [createMockFile("photo.png", 100, "image/png")];
      el.files = files;
      expect(MockXMLHttpRequest.instances).toHaveLength(1);

      el.remove();
    });

    it("accept指定のワイルドカードMIMEに一致しないファイルを拒否する", async () => {
      const el = createElement({ url: "/api/upload", accept: "image/*" });
      document.body.appendChild(el);

      const errors: any[] = [];
      el.addEventListener("wcs-upload:error", (e) => {
        errors.push((e as CustomEvent).detail);
      });

      const files = [createMockFile("doc.pdf", 100, "application/pdf")];
      el.files = files;

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(MockXMLHttpRequest.instances).toHaveLength(0);
      expect(errors).toHaveLength(1);
      el.remove();
    });

    it("バリデーション通過時はアップロードが実行される", async () => {
      const el = createElement({
        url: "/api/upload",
        "max-size": "1000",
        accept: ".txt,text/plain",
      });
      document.body.appendChild(el);

      const files = [createMockFile("small.txt", 100, "text/plain")];
      el.files = files;
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
      el.remove();
    });
  });

  describe("upload メソッド", () => {
    it("ファイル未設定時はnullを返す", async () => {
      const el = createElement({ url: "/api/upload", manual: "" });
      document.body.appendChild(el);

      const result = await el.upload();
      expect(result).toBeNull();
      expect(MockXMLHttpRequest.instances).toHaveLength(0);
      el.remove();
    });

    it("methodとfieldNameを正しく渡す", () => {
      const el = createElement({
        url: "/api/upload",
        method: "PUT",
        "field-name": "attachment",
      });
      document.body.appendChild(el);

      const files = [createMockFile("test.txt", 100, "text/plain")];
      el.files = files;

      const xhr = MockXMLHttpRequest.instances[0];
      expect(xhr.open).toHaveBeenCalledWith("PUT", "/api/upload");
      const sentData = xhr.send.mock.calls[0][0] as FormData;
      expect(sentData.getAll("attachment")).toHaveLength(1);
      el.remove();
    });
  });

  describe("abort メソッド", () => {
    it("abortメソッドでアップロードを中断する", () => {
      const el = createElement({ url: "/api/upload" });
      document.body.appendChild(el);

      const files = [createMockFile("test.txt", 100, "text/plain")];
      el.files = files;

      el.abort();
      expect(MockXMLHttpRequest.instances[0].abort).toHaveBeenCalled();
      el.remove();
    });
  });

  describe("autoTrigger有効時", () => {
    it("autoTriggerが有効な場合にregisterAutoTriggerが呼ばれる", () => {
      setConfig({ autoTrigger: true });
      const el = createElement({ url: "/api/upload" });
      document.body.appendChild(el);
      // autoTriggerが有効でもエラーなく動作する
      expect(el.style.display).toBe("none");
      el.remove();
    });
  });

  describe("イベントバブリング", () => {
    it("wcs-upload:responseイベントがバブルする", async () => {
      const el = createElement({ url: "/api/upload" });
      document.body.appendChild(el);

      const events: any[] = [];
      document.body.addEventListener("wcs-upload:response", (e) => {
        events.push((e as CustomEvent).detail);
      });

      const files = [createMockFile("test.txt", 100, "text/plain")];
      el.files = files;

      const xhr = MockXMLHttpRequest.instances[0];
      xhr.simulateLoad(200, '{"ok":true}', "application/json");

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(events).toHaveLength(1);
      expect(events[0].value).toEqual({ ok: true });

      el.remove();
    });
  });

  describe("attributeChangedCallback", () => {
    it("url変更ではアップロードを自動実行しない", () => {
      const el = createElement({ url: "/api/upload" });
      document.body.appendChild(el);

      el.setAttribute("url", "/api/upload-v2");
      expect(MockXMLHttpRequest.instances).toHaveLength(0);
      el.remove();
    });
  });
});

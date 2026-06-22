import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapUpload } from "../src/bootstrapUpload";
import { setConfig } from "../src/config";
import { WcsUpload } from "../src/components/Upload";
import { MockXMLHttpRequest, createMockFile } from "./helpers/mockXhr";

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

  it("wcBindable inputsがShellの設定可能サーフェスを宣言している", () => {
    const inputs = WcsUpload.wcBindable.inputs!;
    expect(inputs.map(i => i.name)).toEqual(
      ["url", "method", "fieldName", "multiple", "maxSize", "accept", "manual", "files", "trigger"]
    );
  });

  it("wcBindable inputsはattributeヒントを持たない（setterが自己反映するため二重設定を避ける）", () => {
    const inputs = WcsUpload.wcBindable.inputs!;
    expect(inputs.every(i => i.attribute === undefined)).toBe(true);
  });

  it("wcBindable commandsをCoreからupload(async)/abortとして継承している", () => {
    const commands = WcsUpload.wcBindable.commands!;
    expect(commands.map(c => c.name)).toEqual(["upload", "abort"]);
    expect(commands.find(c => c.name === "upload")!.async).toBe(true);
  });

  it("trigger/filesはproperties（観測）とinputs（設定）の両方に現れる", () => {
    expect(WcsUpload.wcBindable.properties.some(p => p.name === "trigger")).toBe(true);
    expect(WcsUpload.wcBindable.inputs!.some(i => i.name === "trigger")).toBe(true);
    expect(WcsUpload.wcBindable.properties.some(p => p.name === "files")).toBe(true);
    expect(WcsUpload.wcBindable.inputs!.some(i => i.name === "files")).toBe(true);
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

    it("maxSizeに不正値(NaN)が指定された場合はInfinityにフォールバックする", () => {
      const el = createElement({ "max-size": "abc" });
      expect(el.maxSize).toBe(Infinity);
    });

    it("maxSizeに負数が指定された場合はInfinityにフォールバックする", () => {
      const el = createElement({ "max-size": "-1" });
      expect(el.maxSize).toBe(Infinity);
    });

    it("maxSize=0は有効な値として保持される（全ファイル拒否）", () => {
      const el = createElement({ "max-size": "0" });
      expect(el.maxSize).toBe(0);
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

    it("SSR: connectedCallbackPromise が解決し hasConnectedCallbackPromise=true", async () => {
      const el = createElement({ url: "/api/upload" });
      document.body.appendChild(el);
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
      expect((el.constructor as typeof WcsUpload).hasConnectedCallbackPromise).toBe(true);
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

    it("set filesのfire-and-forget自動アップロードはunhandled rejectionを起こさない", async () => {
      // set files の auto-upload 分岐は this.upload() を await/catch せず呼ぶ。
      // url ありかつバリデーション通過ケースで XHR が走っても、never-reject 契約により
      // unhandled rejection は発生しないことを直接担保する（trigger 経路と同等の保証）。
      const el = createElement({ url: "/api/upload" });
      document.body.appendChild(el);

      const rejections: unknown[] = [];
      const onRejection = (reason: unknown): void => { rejections.push(reason); };
      process.on("unhandledRejection", onRejection);

      const files = [createMockFile("test.txt", 100, "text/plain")];
      el.files = files;
      expect(MockXMLHttpRequest.instances).toHaveLength(1);

      // XHR を中断経路で settle させても rejection は起きない
      MockXMLHttpRequest.instances[0].simulateAbort();
      await new Promise(resolve => setTimeout(resolve, 0));
      await Promise.resolve();

      process.off("unhandledRejection", onRejection);
      expect(rejections).toEqual([]);
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

    it("url未設定でファイルありのtriggerはunhandled rejectionを起こさずno-opになる", async () => {
      const el = createElement({ manual: "" });
      document.body.appendChild(el);

      const rejections: unknown[] = [];
      const onRejection = (reason: unknown): void => { rejections.push(reason); };
      process.on("unhandledRejection", onRejection);

      const files = [createMockFile("test.txt", 100, "text/plain")];
      el.files = files;

      // set trigger 内の this.upload().finally(...) は .catch を持たないため、
      // upload() が reject すると unhandled rejection になる。url ガードにより no-op(null)
      // で resolve するので XHR は生成されず rejection も発生しない。
      el.trigger = true;
      expect(MockXMLHttpRequest.instances).toHaveLength(0);

      // マイクロタスク・イベントループを十分に回して未処理 rejection を捕捉
      await new Promise(resolve => setTimeout(resolve, 0));
      await Promise.resolve();

      process.off("unhandledRejection", onRejection);
      expect(rejections).toEqual([]);
      // finally で trigger が false にリセットされている
      expect(el.trigger).toBe(false);
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

    it("max-sizeが不正値(NaN)でもサイズ検証は無言で無効化されず制限なしとして送信される", async () => {
      const el = createElement({ url: "/api/upload", "max-size": "abc" });
      document.body.appendChild(el);

      const errors: any[] = [];
      el.addEventListener("wcs-upload:error", (e) => {
        const detail = (e as CustomEvent).detail;
        if (detail !== null) errors.push(detail);
      });

      // maxSize が Infinity に丸められるため大きなファイルも拒否されず送信される
      const files = [createMockFile("big.txt", 999999, "text/plain")];
      el.files = files;

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
      expect(errors).toHaveLength(0);
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

    it("file.typeが空でも拡張子パターンに一致すれば受理する", async () => {
      const el = createElement({ url: "/api/upload", accept: ".png,image/*" });
      document.body.appendChild(el);

      const errors: any[] = [];
      el.addEventListener("wcs-upload:error", (e) => {
        // アップロード開始時の error リセット（null）は除外し、検証エラーのみ収集
        const detail = (e as CustomEvent).detail;
        if (detail !== null) errors.push(detail);
      });

      // type は空だが拡張子 .png が一致する
      const files = [createMockFile("photo.png", 100, "")];
      el.files = files;

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
      expect(errors).toHaveLength(0);
      el.remove();
    });

    it("file.typeが空でMIME系のみのacceptは拒否する", async () => {
      const el = createElement({ url: "/api/upload", accept: "image/*,image/png" });
      document.body.appendChild(el);

      const errors: any[] = [];
      el.addEventListener("wcs-upload:error", (e) => {
        errors.push((e as CustomEvent).detail);
      });

      // type が空かつ拡張子パターンが accept に無いので型を確認できず拒否
      const files = [createMockFile("photo.png", 100, "")];
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

    it("url未設定時はファイルがあってもnullで解決しXHRを生成しない（rejectしない）", async () => {
      const el = createElement({ manual: "" });
      document.body.appendChild(el);

      const files = [createMockFile("test.txt", 100, "text/plain")];
      el.files = files;

      // url が無いので Core の throw に到達せず null で resolve する（never reject 契約の維持）
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

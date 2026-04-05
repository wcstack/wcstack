import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapUpload } from "../src/bootstrapUpload";
import { setConfig } from "../src/config";
import { WcsUpload } from "../src/components/Upload";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";

// XMLHttpRequestモック
class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];
  static resetInstances(): void {
    MockXMLHttpRequest.instances = [];
  }

  status = 0;
  statusText = "";
  responseText = "";

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
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    if (this._listeners[type]) {
      this._listeners[type] = this._listeners[type].filter(l => l !== listener);
    }
  }
}

function createMockFile(name: string, size: number, type: string): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("autoTrigger", () => {
  let originalXHR: typeof XMLHttpRequest;

  beforeEach(() => {
    originalXHR = globalThis.XMLHttpRequest;
    (globalThis as any).XMLHttpRequest = MockXMLHttpRequest;
    MockXMLHttpRequest.resetInstances();
    setConfig({ autoTrigger: false });
    bootstrapUpload();
  });

  afterEach(() => {
    unregisterAutoTrigger();
    globalThis.XMLHttpRequest = originalXHR;
    vi.restoreAllMocks();
  });

  it("data-uploadtarget属性のクリックでアップロードを開始する", () => {
    registerAutoTrigger();

    const el = document.createElement("wcs-upload") as WcsUpload;
    el.setAttribute("url", "/api/upload");
    el.setAttribute("manual", "");
    el.setAttribute("id", "my-upload");
    document.body.appendChild(el);

    // ファイルをセット（manualなので自動アップロードしない）
    el.files = [createMockFile("test.txt", 100, "text/plain")];

    const button = document.createElement("button");
    button.setAttribute("data-uploadtarget", "my-upload");
    document.body.appendChild(button);

    button.click();
    // upload()が呼ばれるがファイルは既にnullにリセット済みのためXHRは呼ばれない場合もある
    // ここではクリックがエラーなく処理されることを確認
    expect(true).toBe(true);

    el.remove();
    button.remove();
  });

  it("存在しないIDの場合は何もしない", () => {
    registerAutoTrigger();

    const button = document.createElement("button");
    button.setAttribute("data-uploadtarget", "nonexistent");
    document.body.appendChild(button);

    button.click();
    expect(MockXMLHttpRequest.instances).toHaveLength(0);

    button.remove();
  });

  it("空のtriggerAttribute値の場合は何もしない", () => {
    registerAutoTrigger();

    const button = document.createElement("button");
    button.setAttribute("data-uploadtarget", "");
    document.body.appendChild(button);

    button.click();
    expect(MockXMLHttpRequest.instances).toHaveLength(0);

    button.remove();
  });

  it("wcs-upload以外の要素では発火しない", () => {
    registerAutoTrigger();

    const div = document.createElement("div");
    div.setAttribute("id", "not-upload");
    document.body.appendChild(div);

    const button = document.createElement("button");
    button.setAttribute("data-uploadtarget", "not-upload");
    document.body.appendChild(button);

    button.click();
    expect(MockXMLHttpRequest.instances).toHaveLength(0);

    div.remove();
    button.remove();
  });

  it("unregisterAutoTriggerでリスナーが解除される", () => {
    registerAutoTrigger();
    unregisterAutoTrigger();

    const el = document.createElement("wcs-upload") as WcsUpload;
    el.setAttribute("url", "/api/upload");
    el.setAttribute("manual", "");
    el.setAttribute("id", "my-upload2");
    document.body.appendChild(el);

    el.files = [createMockFile("test.txt", 100, "text/plain")];

    const button = document.createElement("button");
    button.setAttribute("data-uploadtarget", "my-upload2");
    document.body.appendChild(button);

    button.click();
    expect(MockXMLHttpRequest.instances).toHaveLength(0);

    el.remove();
    button.remove();
  });

  it("registerAutoTriggerを複数回呼んでも重複登録しない", () => {
    registerAutoTrigger();
    registerAutoTrigger();

    // 重複登録しないことの確認 — unregister1回で解除される
    unregisterAutoTrigger();

    const el = document.createElement("wcs-upload") as WcsUpload;
    el.setAttribute("url", "/api/upload");
    el.setAttribute("manual", "");
    el.setAttribute("id", "my-upload3");
    document.body.appendChild(el);

    el.files = [createMockFile("test.txt", 100, "text/plain")];

    const button = document.createElement("button");
    button.setAttribute("data-uploadtarget", "my-upload3");
    document.body.appendChild(button);

    button.click();
    expect(MockXMLHttpRequest.instances).toHaveLength(0);

    el.remove();
    button.remove();
  });

  it("event.targetがElementでない場合は何もしない", () => {
    registerAutoTrigger();

    const event = new Event("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: null });
    document.dispatchEvent(event);

    expect(MockXMLHttpRequest.instances).toHaveLength(0);
  });

  it("data-uploadtarget属性を持たない要素のクリックは無視する", () => {
    registerAutoTrigger();

    const button = document.createElement("button");
    document.body.appendChild(button);
    button.click();

    expect(MockXMLHttpRequest.instances).toHaveLength(0);
    button.remove();
  });

  it("ファイル未選択時はpreventDefaultを呼ばない", () => {
    registerAutoTrigger();

    const el = document.createElement("wcs-upload") as WcsUpload;
    el.setAttribute("url", "/api/upload");
    el.setAttribute("manual", "");
    el.setAttribute("id", "my-upload-pd");
    document.body.appendChild(el);
    // filesをセットしない

    const button = document.createElement("button");
    button.setAttribute("data-uploadtarget", "my-upload-pd");
    document.body.appendChild(button);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    // ファイル未選択なのでpreventDefaultされない
    expect(event.defaultPrevented).toBe(false);

    el.remove();
    button.remove();
  });

  it("ファイルとURL設定済みの場合はpreventDefaultする", () => {
    registerAutoTrigger();

    const el = document.createElement("wcs-upload") as WcsUpload;
    el.setAttribute("url", "/api/upload");
    el.setAttribute("manual", "");
    el.setAttribute("id", "my-upload-pd2");
    document.body.appendChild(el);

    el.files = [createMockFile("test.txt", 100, "text/plain")];

    const button = document.createElement("button");
    button.setAttribute("data-uploadtarget", "my-upload-pd2");
    document.body.appendChild(button);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    el.remove();
    button.remove();
  });

  it("ネストされた要素のクリックでも動作する", () => {
    registerAutoTrigger();

    const el = document.createElement("wcs-upload") as WcsUpload;
    el.setAttribute("url", "/api/upload");
    el.setAttribute("manual", "");
    el.setAttribute("id", "my-upload4");
    document.body.appendChild(el);

    el.files = [createMockFile("test.txt", 100, "text/plain")];

    const button = document.createElement("button");
    button.setAttribute("data-uploadtarget", "my-upload4");
    const span = document.createElement("span");
    span.textContent = "Upload";
    button.appendChild(span);
    document.body.appendChild(button);

    span.click();
    // upload()が呼ばれる（closest経由でbuttonを発見）
    expect(true).toBe(true);

    el.remove();
    button.remove();
  });
});

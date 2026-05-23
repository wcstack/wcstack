import { vi } from "vitest";

/**
 * テスト用の XMLHttpRequest モック。
 *
 * 生成インスタンスを `instances` に蓄積し、`simulate*` ヘルパーで
 * progress / load / error / abort の各イベントを手動発火できる。
 * uploadCore / upload / autoTrigger の各テストで共有する。
 */
export class MockXMLHttpRequest {
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

  // Upload target (progress events fire here)
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
      this._listeners[type] = this._listeners[type].filter((l) => l !== listener);
    }
  }

  // --- テストヘルパー ---

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

/**
 * 指定サイズ・MIME type のダミー File を生成する。
 */
export function createMockFile(name: string, size: number, type: string): File {
  return new File([new Uint8Array(size)], name, { type });
}

import { IWcBindable } from "../types.js";

export interface UploadRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  fieldName?: string;
}

export class UploadCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "value", event: "wcs-upload:response", getter: (e: Event) => (e as CustomEvent).detail.value },
      { name: "loading", event: "wcs-upload:loading-changed" },
      { name: "progress", event: "wcs-upload:progress" },
      { name: "error", event: "wcs-upload:error" },
      { name: "status", event: "wcs-upload:response", getter: (e: Event) => (e as CustomEvent).detail.status },
    ],
    inputs: [
      { name: "url" },
      { name: "method" },
      { name: "fieldName" },
    ],
    commands: [
      { name: "upload", async: true },
      { name: "abort" },
    ],
  };

  private _target: EventTarget;
  private _value: any = null;
  private _loading: boolean = false;
  private _progress: number = 0;
  private _error: any = null;
  private _status: number = 0;
  private _xhr: XMLHttpRequest | null = null;
  private _promise: Promise<any> = Promise.resolve(null);
  // Generation guard: bumped on dispose() (and each upload start). An in-flight
  // request that settles after dispose / a superseding start has a stale `gen`
  // and MUST NOT write state to a torn-down element. A boolean flag is
  // insufficient (dispose→observe would let stale work slip through).
  private _gen = 0;
  // SSR: no asynchronous probe to await, so readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  // Lifecycle (§3.5). Upload is command-driven with no subscription to
  // establish, so observe() is an idempotent no-op that resolves once ready;
  // dispose() invalidates any in-flight request and aborts it.
  observe(): Promise<void> {
    return this._ready;
  }

  dispose(): void {
    this._gen++;
    this.abort();
  }

  get value(): any {
    return this._value;
  }

  get loading(): boolean {
    return this._loading;
  }

  get progress(): number {
    return this._progress;
  }

  get error(): any {
    return this._error;
  }

  get status(): number {
    return this._status;
  }

  get promise(): Promise<any> {
    return this._promise;
  }

  // --- State setters with event dispatch ---

  private _setLoading(loading: boolean): void {
    this._loading = loading;
    this._target.dispatchEvent(new CustomEvent("wcs-upload:loading-changed", {
      detail: loading,
      bubbles: true,
    }));
  }

  private _setProgress(progress: number): void {
    this._progress = progress;
    this._target.dispatchEvent(new CustomEvent("wcs-upload:progress", {
      detail: progress,
      bubbles: true,
    }));
  }

  private _setError(error: any): void {
    // Same-value guard (async-io-node-guidelines.md §3.3). `error` is state-ish,
    // so suppressing redundant null→null dispatches (every upload start clears a
    // usually-already-null error) avoids a spurious wcs-upload:error per
    // successful upload. Reference identity is sufficient: each failure builds a
    // fresh object, and the clear path always passes null.
    if (this._error === error) return;
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-upload:error", {
      detail: error,
      bubbles: true,
    }));
  }

  // Surface a Shell-originated error (e.g. maxSize / accept validation, which the
  // Core has no knowledge of) on the shared `error` property so `el.error` stays
  // sticky and consistent with Core-originated errors — same error contract as the
  // rest of the @wcstack IO nodes. A later successful upload() clears it via
  // _setError(null). Dispatches wcs-upload:error like any other error transition.
  setError(error: any): void {
    this._setError(error);
  }

  private _setResponse(value: any, status: number): void {
    this._value = value;
    this._status = status;
    this._target.dispatchEvent(new CustomEvent("wcs-upload:response", {
      detail: { value, status },
      bubbles: true,
    }));
  }

  // --- Public API ---

  abort(): void {
    // `_xhr` は send() の直前に同期で代入されるため、send 前に外部から abort が
    // 割り込む余地はない（割り込み点となる await が存在しない）。よって XHR.abort()
    // は常に進行中のリクエストに対して呼ばれ、abort イベントが発火して loading を
    // 解除する。loading の解除を abort イベントハンドラに集約しているのは、
    // ネットワークエラー/HTTP エラー/正常完了/中断のすべてで解除経路を一本化し、
    // FetchCore.abort() と挙動を揃えるため。
    if (this._xhr) {
      this._xhr.abort();
      this._xhr = null;
    }
  }

  async upload(url: string, files: FileList | File[], options: UploadRequestOptions = {}): Promise<any> {
    // never-throw: 引数バリデーション失敗は例外ではなく error プロパティに流し、
    // サニタイズ値(null)を返す。command-token 経路からの呼び出しが unhandled
    // rejection にならず、「upload() は全終了ケースで resolve」契約とも整合する。
    if (!url) {
      this._setError({ message: "url is required." });
      return null;
    }
    if (!files || files.length === 0) {
      this._setError({ message: "files are required." });
      return null;
    }

    const p = this._doUpload(url, files, options);
    this._promise = p;
    return p;
  }

  // --- Internal ---

  private _doUpload(url: string, files: FileList | File[], options: UploadRequestOptions): Promise<any> {
    // 既存のアップロードを中止
    this.abort();

    this._setLoading(true);
    this._setProgress(0);
    this._setError(null);

    const {
      method = "POST",
      headers = {},
      fieldName = "file",
    } = options;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append(fieldName, files[i]);
    }

    const gen = ++this._gen;

    return new Promise<any>((resolve) => {
      const xhr = new XMLHttpRequest();
      this._xhr = xhr;

      xhr.upload.addEventListener("progress", (event: ProgressEvent) => {
        if (gen !== this._gen) return;
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          this._setProgress(percent);
        }
      });

      xhr.addEventListener("load", () => {
        this._xhr = null;
        if (gen !== this._gen) { resolve(null); return; }
        this._status = xhr.status;

        if (xhr.status >= 200 && xhr.status < 300) {
          let value: any = xhr.responseText;
          const contentType = xhr.getResponseHeader("Content-Type") || "";
          if (contentType.includes("application/json")) {
            try {
              value = JSON.parse(xhr.responseText);
            } catch {
              // テキストのまま
            }
          }
          this._setProgress(100);
          this._setResponse(value, xhr.status);
          this._setLoading(false);
          resolve(value);
        } else {
          const error = {
            status: xhr.status,
            statusText: xhr.statusText,
            body: xhr.responseText,
          };
          this._setError(error);
          this._setLoading(false);
          resolve(null);
        }
      });

      xhr.addEventListener("error", () => {
        this._xhr = null;
        if (gen !== this._gen) { resolve(null); return; }
        this._setError({ message: "Network error" });
        this._setLoading(false);
        resolve(null);
      });

      xhr.addEventListener("abort", () => {
        this._xhr = null;
        if (gen !== this._gen) { resolve(null); return; }
        this._setLoading(false);
        resolve(null);
      });

      xhr.open(method, url);

      for (const [name, value] of Object.entries(headers)) {
        xhr.setRequestHeader(name, value);
      }

      xhr.send(formData);
    });
  }
}

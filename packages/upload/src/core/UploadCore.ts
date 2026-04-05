import { raiseError } from "../raiseError.js";
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
  };

  private _target: EventTarget;
  private _value: any = null;
  private _loading: boolean = false;
  private _progress: number = 0;
  private _error: any = null;
  private _status: number = 0;
  private _xhr: XMLHttpRequest | null = null;
  private _promise: Promise<any> = Promise.resolve(null);

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
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
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-upload:error", {
      detail: error,
      bubbles: true,
    }));
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
    if (this._xhr) {
      this._xhr.abort();
      this._xhr = null;
    }
  }

  upload(url: string, files: FileList | File[], options: UploadRequestOptions = {}): Promise<any> {
    if (!url) {
      raiseError("url is required.");
    }
    if (!files || files.length === 0) {
      raiseError("files are required.");
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
    this._error = null;

    const {
      method = "POST",
      headers = {},
      fieldName = "file",
    } = options;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append(fieldName, files[i]);
    }

    return new Promise<any>((resolve) => {
      const xhr = new XMLHttpRequest();
      this._xhr = xhr;

      xhr.upload.addEventListener("progress", (event: ProgressEvent) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          this._setProgress(percent);
        }
      });

      xhr.addEventListener("load", () => {
        this._xhr = null;
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
        this._setError({ message: "Network error" });
        this._setLoading(false);
        resolve(null);
      });

      xhr.addEventListener("abort", () => {
        this._xhr = null;
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

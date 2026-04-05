import { config } from "../config.js";
import { IWcBindable, WcsUploadError } from "../types.js";
import { UploadCore } from "../core/UploadCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";

export class WcsUpload extends HTMLElement {
  static hasConnectedCallbackPromise = false;
  static wcBindable: IWcBindable = {
    ...UploadCore.wcBindable,
    properties: [
      ...UploadCore.wcBindable.properties,
      { name: "trigger", event: "wcs-upload:trigger-changed" },
      { name: "files", event: "wcs-upload:files-changed" },
    ],
  };
  static get observedAttributes(): string[] { return ["url"]; }

  private _core: UploadCore;
  private _files: FileList | File[] | null = null;
  private _trigger: boolean = false;

  constructor() {
    super();
    this._core = new UploadCore(this);
  }

  // --- Attribute accessors ---

  get url(): string {
    return this.getAttribute("url") || "";
  }

  set url(value: string) {
    this.setAttribute("url", value);
  }

  get method(): string {
    return (this.getAttribute("method") || "POST").toUpperCase();
  }

  set method(value: string) {
    this.setAttribute("method", value);
  }

  get fieldName(): string {
    return this.getAttribute("field-name") || "file";
  }

  set fieldName(value: string) {
    this.setAttribute("field-name", value);
  }

  get multiple(): boolean {
    return this.hasAttribute("multiple");
  }

  set multiple(value: boolean) {
    if (value) {
      this.setAttribute("multiple", "");
    } else {
      this.removeAttribute("multiple");
    }
  }

  get maxSize(): number {
    const attr = this.getAttribute("max-size");
    return attr ? parseInt(attr, 10) : Infinity;
  }

  set maxSize(value: number) {
    this.setAttribute("max-size", String(value));
  }

  get accept(): string {
    return this.getAttribute("accept") || "";
  }

  set accept(value: string) {
    this.setAttribute("accept", value);
  }

  get manual(): boolean {
    return this.hasAttribute("manual");
  }

  set manual(value: boolean) {
    if (value) {
      this.setAttribute("manual", "");
    } else {
      this.removeAttribute("manual");
    }
  }

  // --- Core delegated getters ---

  get value(): any {
    return this._core.value;
  }

  get loading(): boolean {
    return this._core.loading;
  }

  get progress(): number {
    return this._core.progress;
  }

  get error(): any {
    return this._core.error;
  }

  get status(): number {
    return this._core.status;
  }

  get promise(): Promise<any> {
    return this._core.promise;
  }

  // --- Command properties ---

  get trigger(): boolean {
    return this._trigger;
  }

  set trigger(value: boolean) {
    const v = !!value;
    if (v) {
      this._trigger = true;
      this.upload().finally(() => {
        this._trigger = false;
        this.dispatchEvent(new CustomEvent("wcs-upload:trigger-changed", {
          detail: false,
          bubbles: true,
        }));
      });
    }
  }

  get files(): FileList | File[] | null {
    return this._files;
  }

  set files(value: FileList | File[] | null) {
    this._files = value;
    this.dispatchEvent(new CustomEvent("wcs-upload:files-changed", {
      detail: value,
      bubbles: true,
    }));
    if (!this.manual && this.url && value && value.length > 0) {
      this.upload();
    }
  }

  // --- Validation ---

  private _validate(files: FileList | File[]): WcsUploadError | null {
    const maxSize = this.maxSize;
    if (maxSize !== Infinity) {
      for (let i = 0; i < files.length; i++) {
        if (files[i].size > maxSize) {
          return { message: `File "${files[i].name}" exceeds maximum size of ${maxSize} bytes.` };
        }
      }
    }

    const accept = this.accept;
    if (accept) {
      const acceptList = accept.split(",").map(s => s.trim().toLowerCase());
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileType = file.type.toLowerCase();
        const fileName = file.name.toLowerCase();
        const matched = acceptList.some(pattern => {
          if (pattern.startsWith(".")) {
            return fileName.endsWith(pattern);
          }
          if (pattern.endsWith("/*")) {
            return fileType.startsWith(pattern.slice(0, -1));
          }
          return fileType === pattern;
        });
        if (!matched) {
          return { message: `File "${file.name}" does not match accepted types: ${accept}` };
        }
      }
    }

    return null;
  }

  // --- Public methods ---

  abort(): void {
    this._core.abort();
  }

  async upload(): Promise<any> {
    const files = this._files;
    if (!files || files.length === 0) {
      return null;
    }

    const validationError = this._validate(files);
    if (validationError) {
      this.dispatchEvent(new CustomEvent("wcs-upload:error", {
        detail: validationError,
        bubbles: true,
      }));
      return null;
    }

    const result = await this._core.upload(this.url, files, {
      method: this.method,
      fieldName: this.fieldName,
    });

    // 自分が開始したアップロードのファイルだけをリセット
    // （途中で新しい files がセットされていたら触らない）
    if (this._files === files) {
      this._files = null;
      this.dispatchEvent(new CustomEvent("wcs-upload:files-changed", {
        detail: null,
        bubbles: true,
      }));
    }

    return result;
  }

  // --- Lifecycle ---

  attributeChangedCallback(_name: string, _oldValue: string | null, _newValue: string | null): void {
    // URL変更ではアップロードを自動実行しない（ファイルが必要なため）
  }

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
  }

  disconnectedCallback(): void {
    this._core.abort();
  }
}

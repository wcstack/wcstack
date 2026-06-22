import { config } from "../config.js";
import { IWcBindable, WcsUploadError } from "../types.js";
import { UploadCore } from "../core/UploadCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";

export class WcsUpload extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...UploadCore.wcBindable,
    properties: [
      ...UploadCore.wcBindable.properties,
      { name: "trigger", event: "wcs-upload:trigger-changed" },
      { name: "files", event: "wcs-upload:files-changed" },
    ],
    // Shell-level input surface. The Core declares only the portable `url` / `method` /
    // `fieldName`; the Shell adds the DOM-driven settable surface. No `attribute` hints
    // are given: the `url` / `method` / `fieldName` / `multiple` / `maxSize` / `accept` /
    // `manual` setters already reflect to their attributes, so a binding system that
    // mirrors inputs[].attribute would set the attribute twice (`files` / `trigger` are
    // not attribute-backed). `commands` (upload / abort) are inherited unchanged from the
    // Core via the spread above.
    inputs: [
      { name: "url" },
      { name: "method" },
      { name: "fieldName" },
      { name: "multiple" },
      { name: "maxSize" },
      { name: "accept" },
      { name: "manual" },
      { name: "files" },
      { name: "trigger" },
    ],
  };
  // `url` を観測するのは FetchCore のシェルと構造を揃えるためだが、upload は
  // url 変更だけでは送信できない（files が必須）。そのため attributeChangedCallback は
  // 意図的に何もしない。url 変更で自動送信しないことは仕様であり、テストで担保している。
  static get observedAttributes(): string[] { return ["url"]; }

  private _core: UploadCore;
  private _files: FileList | File[] | null = null;
  private _trigger: boolean = false;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._core = new UploadCore(this);
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
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
    if (attr === null) {
      return Infinity;
    }
    // 不正値（NaN になる "abc" など）や負数は「制限なし」(Infinity) として扱う。
    // NaN を返すと `size > NaN` が常に false になりサイズ検証が無言で無効化され、
    // 負数を返すと全ファイルが拒否されるため、いずれも安全側の Infinity に丸める。
    const n = parseInt(attr, 10);
    return Number.isFinite(n) && n >= 0 ? n : Infinity;
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
    // 進行中に再度 trigger=true が来ても再入ガードはしない（FetchCore シェルと同一）。
    // upload() → _core.upload() が先頭で既存リクエストを abort し新規開始するため、
    // 連続トリガは「前回を中止して新しいアップロードを開始する」挙動になる。
    // 各 upload() の settle ごとに trigger-changed(false) が 1 回発火する。
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
        // file.type が空文字（OS が MIME を判定できないファイル）の場合、MIME 系
        // パターン（`image/*` / 厳密 MIME）は一致しない。その場合でも accept に
        // 拡張子パターン（`.pdf` 等）が含まれ拡張子が一致すれば受理される。
        // accept が MIME 系のみのときは型を確認できないため拒否する（安全側）。
        const matched = acceptList.some(pattern => {
          if (pattern.startsWith(".")) {
            return fileName.endsWith(pattern);
          }
          if (pattern.endsWith("/*")) {
            return fileType !== "" && fileType.startsWith(pattern.slice(0, -1));
          }
          return fileType !== "" && fileType === pattern;
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
    // url 未設定は no-op(null)。Core は url 空で throw するが、Shell は url/files の
    // ライフサイクルを所有しており「送信先が無い」を「ファイル無し」と同じ無操作として扱う。
    // これにより set trigger / set files の fire-and-forget 経路で unhandled rejection が
    // 発生せず、README の「upload() は全終了ケースで resolve し never reject」契約とも整合する。
    if (!files || files.length === 0 || !this.url) {
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
    // 意図的に空。url 変更ではアップロードを自動実行しない（files が必要なため）。
    // observedAttributes のコメント参照。
  }

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    this._connectedCallbackPromise = this._core.observe();
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }
}

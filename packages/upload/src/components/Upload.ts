import { config } from "../config.js";
import { IWcBindable, WcsUploadError } from "../types.js";
import { UploadCore } from "../core/UploadCore.js";
import type { WcsUploadHeader } from "./UploadHeader.js";
import { WcsIoErrorInfo } from "../core/platformCapability.js";
import { registerAutoTrigger } from "../autoTrigger.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";
import { reflectAttribute, reflectBooleanAttribute } from "../protocol/inputAttribute.js";

export class WcsUpload extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...UploadCore.wcBindable,
    properties: [
      ...UploadCore.wcBindable.properties,
      { name: "trigger", event: "wcs-upload:trigger-changed", semantics: "state" },
      { name: "files", event: "wcs-upload:files-changed", semantics: "state" },
    ],
    // Shell-level input surface. The Core declares only the portable `url` / `method` /
    // `fieldName`; the Shell adds the DOM-driven settable surface. No `attribute` hints
    // are given: the `url` / `method` / `fieldName` / `multiple` / `maxSize` / `accept` /
    // `manual` setters reflect to their attributes themselves, and a binding system that
    // mirrored inputs[].attribute (@wcstack/state 3.x) would set the attribute twice
    // (`files` / `trigger` are not attribute-backed). `commands` (upload / abort) are inherited unchanged from the
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
  // `url` を観測するのは、url の無いうちに自動送信の files を受けたとき、url が来たらその
  // files を送るため（4.5 までは url を待たずに黙って何もしなかった。JSX の props や data-wcs の
  // 束縛は書いた順に当たるので、files を url より前に書くと送られなかった — docs/seam-apps.md、
  // state-field-report と fw-inventory）。それ以外の url の変更では送らない。
  static get observedAttributes(): string[] { return ["url"]; }

  private _core: UploadCore;
  private _files: FileList | File[] | null = null;
  private _trigger: boolean = false;
  // The reasons `[wcs/command-not-ready]` was said for in this outage, once each
  // (docs/v4-direction-2026-10.md §5.1, the I/O command policy); an upload starting clears them.
  private _told: Set<string> | null = null;
  // `[wcs/upload-helper-undefined]` was said for this element (once per element, as fetch's)
  private _toldUndefinedHelper = false;
  // automatic-mode files assigned while there was no url: sent when the url arrives
  private _waitingForUrl = false;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new UploadCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-upload:loading-changed": (d) => ({ loading: d === true }),
      "wcs-upload:error":           (d) => ({ error: d != null }),
    });
  }

  // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
  // wc-bindable (not a bind target); see README "CSS styling with :state()".
  // MUST NOT return the live CustomStateSet (that would let callers write
  // states from outside, defeating the point of :state() being read-only).
  get debugStates(): string[] {
    return this._internals ? [...this._internals.states] : [];
  }

  private _initInternals(): ElementInternals | null {
    // never-throw (async-io-node-guidelines.md §3.6): attachInternals is absent
    // in happy-dom / older environments, and pre-125 Chromium rejects
    // non-dashed state names from states.add() (probed and discarded here).
    // Either case silently disables reflection — the component still works,
    // it just doesn't expose :state() selectors.
    try {
      if (typeof this.attachInternals !== "function") return null;
      const internals = this.attachInternals();
      internals.states.add("wcs-probe");
      internals.states.delete("wcs-probe");
      return internals;
    } catch {
      return null;
    }
  }

  private _wireStates(map: Record<string, (detail: any) => Record<string, boolean>>): void {
    if (this._internals === null) return;
    const states = this._internals.states;
    for (const [event, toStates] of Object.entries(map)) {
      this.addEventListener(event, (e) => {
        const debug = this.hasAttribute("debug-states");
        for (const [name, on] of Object.entries(toStates((e as CustomEvent).detail))) {
          try {
            if (on) { states.add(name); } else { states.delete(name); }
          } catch { /* never-throw */ }
          if (debug) this.toggleAttribute(`data-wcs-state-${name}`, on);
        }
      });
    }
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Attribute accessors ---
  //
  // setter は null / undefined を setAttribute に文字列化させない（"undefined" の url へ
  // 送信したり、"null" の method を使ったりしないため）。`null` は属性を外して既定値に戻し、
  // `undefined` は要素が最初に持っていた属性へ戻す（wc-bindable producer guidance P1。
  // React 19 や直接の代入は undefined を書く。@wcstack/state は書かない）。

  get url(): string {
    return this.getAttribute("url") || "";
  }

  set url(value: string | null | undefined) {
    reflectAttribute(this, "url", value);
  }

  get method(): string {
    return (this.getAttribute("method") || "POST").toUpperCase();
  }

  set method(value: string | null | undefined) {
    reflectAttribute(this, "method", value);
  }

  get fieldName(): string {
    return this.getAttribute("field-name") || "file";
  }

  set fieldName(value: string | null | undefined) {
    reflectAttribute(this, "field-name", value);
  }

  get multiple(): boolean {
    return this.hasAttribute("multiple");
  }

  set multiple(value: boolean | null | undefined) {
    reflectBooleanAttribute(this, "multiple", value);
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

  set maxSize(value: number | null | undefined) {
    reflectAttribute(this, "max-size", value);
  }

  get accept(): string {
    return this.getAttribute("accept") || "";
  }

  set accept(value: string | null | undefined) {
    reflectAttribute(this, "accept", value);
  }

  get manual(): boolean {
    return this.hasAttribute("manual");
  }

  set manual(value: boolean | null | undefined) {
    reflectBooleanAttribute(this, "manual", value);
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

  get errorInfo(): WcsIoErrorInfo | null {
    return this._core.errorInfo;
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

  set files(value: FileList | File[] | null | undefined) {
    // undefined は「値が無い」= 初期状態（null）。null と同じく files をクリアし、
    // files-changed にも undefined ではなく null を載せる。
    const files = value ?? null;
    this._files = files;
    this.dispatchEvent(new CustomEvent("wcs-upload:files-changed", {
      detail: files,
      bubbles: true,
    }));
    // files that arrive before the url wait for it (automatic mode only)
    this._waitingForUrl = !this.manual && !!files && files.length > 0 && !this.url;
    if (!this.manual && files && files.length > 0 && this.url) this.upload();
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
    // url 未設定は no-op(null)。Core は never-throw（url 空なら error プロパティに
    // 載せて null を返す）だが、Shell は url/files のライフサイクルを所有しており
    // 「送信先が無い」を「ファイル無し」と同じ無操作として扱い、Core を呼ぶ前に return する。
    // これにより set trigger / set files の fire-and-forget 経路で unhandled rejection が
    // 発生せず、README の「upload() は全終了ケースで resolve し never reject」契約とも整合する。
    if (!files || files.length === 0 || !this.url) {
      this._warnNotReady(!this.url ? "there is no url" : "there are no files");
      return null;
    }

    const validationError = this._validate(files);
    if (validationError) {
      // Route through the Core so `el.error` (which reads _core.error) reflects
      // the validation failure and stays sticky until the next successful upload,
      // matching the family-wide error contract. The Core dispatches
      // wcs-upload:error on this element (its _target), so the observable event is
      // unchanged.
      this._core.setError(validationError);
      return null;
    }

    // ready again (an upload starts): a refusal in the next outage is said again
    this._told = null;
    // the <wcs-upload-header> elements inside, read now: a header bound from state goes out with
    // the value it has when the upload starts, not the one it had when the element connected
    const headers = this._collectHeaders();
    // An upload is always multipart/form-data: a manual Content-Type drops the boundary the
    // browser adds, and the server cannot read the parts. Sent as written (as fetch does), but said.
    if (Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
      console.warn(
        "[@wcstack/upload] A Content-Type header was set on an upload. An upload is sent as " +
          "multipart/form-data, and a manual Content-Type drops the boundary the browser adds; " +
          `remove the Content-Type <${config.tagNames.uploadHeader}>.`,
        this,
      );
    }
    const result = await this._core.upload(this.url, files, {
      method: this.method,
      fieldName: this.fieldName,
      headers,
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

  private _collectHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const headerElements = this.querySelectorAll<WcsUploadHeader>(config.tagNames.uploadHeader);
    for (const el of headerElements) {
      if (typeof el.hasHeader !== "boolean") {
        this._warnUndefinedHelper(config.tagNames.uploadHeader);
        continue;
      }
      // a header without a value attribute is not sent (WcsUploadHeader)
      if (el.hasHeader) {
        headers[el.name] = el.value;
      }
    }
    return headers;
  }

  /**
   * A `<wcs-upload-header>` whose definition never loaded is a plain element, and its header would
   * be left out of the upload without a word: a page that defines the tags itself (an autoloader's
   * wrapper module, a scoped registry) defined `<wcs-upload>` only — fetch's
   * `[wcs/fetch-helper-undefined]` (docs/seam-apps.md, fw-inventory). Said once per element.
   */
  private _warnUndefinedHelper(tag: string): void {
    if (this._toldUndefinedHelper) return;
    this._toldUndefinedHelper = true;
    console.warn(
      `[@wcstack/upload] [wcs/upload-helper-undefined] <${tag}> inside this <${config.tagNames.upload}> is not ` +
        "defined, so its header is not sent. Load @wcstack/upload/auto, or define WcsUploadHeader with WcsUpload " +
        "when the page defines the tags itself. (Said once per element.)",
      this,
    );
  }

  // A refused upload sent nothing and said nothing (no `error`, by design): a `trigger`
  // written before `url` / `files` (`data-wcs` bindings and a framework's props are applied in
  // the order written), a retry after the files were used up. Said once per reason and outage:
  // once per element was once per page life — a route puts the same element back on every
  // entry, so the next outage went unsaid (docs/seam-apps.md, shift-desk).
  private _warnNotReady(reason: string): void {
    if (this._told?.has(reason)) return;
    (this._told ??= new Set()).add(reason);
    console.warn(
      `[@wcstack/upload] [wcs/command-not-ready] The upload was refused: ${reason}, so nothing is sent. ` +
        "Write url and files before trigger (data-wcs bindings and a framework's props are applied in the order " +
        "written), and assign files again for each retry: an upload uses them up. " +
        "(Said once per reason until an upload is sent again.)",
      this,
    );
  }

  // --- Lifecycle ---

  attributeChangedCallback(_name: string, _oldValue: string | null, newValue: string | null): void {
    // url だけの変更では送らない。url の無いうちに受けた自動送信の files は、url が来たら送る。
    // 接続は問わない: React 19 は要素を文書に入れる前に props を当てる（files の setter も、url が
    // あれば接続の前に送る）。
    if (!this._waitingForUrl || !newValue || this.manual) return;
    // (waiting means files were assigned and not replaced since: the setter resets it)
    this._waitingForUrl = false;
    this.upload();
  }

  connectedCallback(): void {
    // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
    upgradeProperties(this);
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

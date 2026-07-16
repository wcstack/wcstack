import { IWcBindable } from "../types.js";
import { OperationLane, OperationTicket } from "./operationLane.js";
import {
  PlatformAssessment,
  WcsIoErrorInfo,
  WcsIoErrorPhase,
  assessCapabilities,
  requiredCapabilitiesAvailable,
} from "./platformCapability.js";
import { UPLOAD_CAPABILITIES, WCS_UPLOAD_ERROR_CODE } from "./uploadCapabilities.js";

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
      // Serializable failure taxonomy (stable code / phase / recoverable), or null.
      // Additive bindable output; the existing `error` property/event are unchanged.
      // Fires its own `wcs-upload:error-info-changed` event; no getter, so the bound
      // value is the event detail (mirrors `error` / `loading`). An abort() is not a
      // failure — it clears loading without setting error/errorInfo.
      { name: "errorInfo", event: "wcs-upload:error-info-changed" },
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

  // Required capability (probed at call time, never at module eval).
  private static readonly REQUIRED_CAPABILITIES = ["web.xhr"] as const;

  private _target: EventTarget;
  private _value: any = null;
  private _loading: boolean = false;
  private _progress: number = 0;
  private _error: any = null;
  private _status: number = 0;
  private _errorInfo: WcsIoErrorInfo | null = null;
  private _xhr: XMLHttpRequest | null = null;
  private _promise: Promise<any> = Promise.resolve(null);
  // Concurrency lane (io-core). `latest`: a new upload supersedes the in-flight one
  // (switchMap). `withSignal: false`: upload uses XMLHttpRequest.abort() rather than
  // an AbortSignal, so the lane owns epoch / commit-guard while abort() below owns
  // the XHR cancellation. dispose() bumps the owner generation and aborts the XHR.
  private _lane = new OperationLane("upload", "latest", { withSignal: false });
  // SSR: no asynchronous probe to await, so readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  // Lifecycle (§3.5). Upload is command-driven with no subscription to establish,
  // so observe() is an idempotent no-op that resolves once ready; dispose() bumps
  // the lane's owner generation (invalidating any in-flight upload) and aborts the
  // XHR.
  observe(): Promise<void> {
    return this._ready;
  }

  dispose(): void {
    this._lane.disposeOwner();
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

  /**
   * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
   * `recoverable` / `capabilityId`), or null. Exposed as an additive wc-bindable
   * property (event `wcs-upload:error-info-changed`); the existing `error`
   * property/event are unchanged. An abort() is not a failure (no errorInfo).
   */
  get errorInfo(): WcsIoErrorInfo | null {
    return this._errorInfo;
  }

  /**
   * Whether the required platform capability (`web.xhr`) is available right now —
   * decided by call-time feature detection, not User-Agent. Core-only, additive.
   */
  get supported(): boolean {
    return requiredCapabilitiesAvailable(this.platformAssessment, UploadCore.REQUIRED_CAPABILITIES);
  }

  /**
   * Full platform assessment (availability / readiness / preconditions), probed at
   * call time. Core-only opt-in dev / sidecar view.
   */
  get platformAssessment(): PlatformAssessment {
    return assessCapabilities(UPLOAD_CAPABILITIES, {
      required: UploadCore.REQUIRED_CAPABILITIES,
      activity: this._loading ? "active" : "inactive",
      lastError: this._errorInfo ?? undefined,
    });
  }

  // CommitGuard (§5.1): external setters / event dispatch only run if the ticket
  // still holds owner generation, is pre-terminal, and is the lane's latest epoch
  // (a superseding upload can invalidate a ticket mid-commit).
  private _commitStep(ticket: OperationTicket, step: () => void): void {
    if (this._lane.canCommit(ticket)) {
      step();
    }
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

  // Single mutation point for `errorInfo`, mirroring `_setError`'s same-value guard
  // and event dispatch so the additive `errorInfo` wc-bindable property stays in
  // sync with `error`. Each failure builds a fresh object (reference guard passes);
  // the clear path passes null (suppresses a redundant null→null per upload start).
  private _setErrorInfo(code: string, phase: WcsIoErrorPhase, recoverable: boolean, message: string, capabilityId?: string): void {
    this._commitErrorInfo({ code, phase, recoverable, message, ...(capabilityId === undefined ? {} : { capabilityId }) });
  }

  private _commitErrorInfo(info: WcsIoErrorInfo | null): void {
    if (this._errorInfo === info) return;
    this._errorInfo = info;
    this._target.dispatchEvent(new CustomEvent("wcs-upload:error-info-changed", {
      detail: info,
      bubbles: true,
    }));
  }

  // --- Public API ---

  abort(): void {
    // Abort the current XHR. Its `abort` event handler claims the `aborted` terminal
    // (while the ticket is still latest — abort() runs before a superseding upload's
    // begin()), unifying the loading-release path with success/error/network. When a
    // superseding upload or dispose() has already advanced the epoch/owner gen, the
    // handler's claim fails and it writes nothing (stale-drop).
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
      this._setErrorInfo(WCS_UPLOAD_ERROR_CODE.InvalidArgument, "start", false, "url is required.");
      this._setError({ message: "url is required." });
      return null;
    }
    if (!files || files.length === 0) {
      this._setErrorInfo(WCS_UPLOAD_ERROR_CODE.InvalidArgument, "start", false, "files are required.");
      this._setError({ message: "files are required." });
      return null;
    }

    const p = this._doUpload(url, files, options);
    this._promise = p;
    return p;
  }

  // --- Internal ---

  private _doUpload(url: string, files: FileList | File[], options: UploadRequestOptions): Promise<any> {
    // Probe the required capability just before starting (SSR / very old runtime).
    const assessment = this.platformAssessment;
    if (!requiredCapabilitiesAvailable(assessment, UploadCore.REQUIRED_CAPABILITIES)) {
      const missing = UploadCore.REQUIRED_CAPABILITIES.find((id) => assessment.availability.get(id) !== "available");
      const message = `Required capability "${missing}" is unavailable.`;
      this._setErrorInfo(WCS_UPLOAD_ERROR_CODE.CapabilityMissing, "start", false, message, missing);
      this._setError({ message });
      return Promise.resolve(null);
    }

    // Abort the previous XHR BEFORE advancing the epoch, so its `abort` handler
    // claims `aborted` while still latest (preserving the loading true→false→true
    // supersede sequence). Then begin() advances the epoch for THIS upload.
    this.abort();
    const started = this._lane.begin()!; // `latest` begin never returns null
    const { ticket } = started;

    this._commitStep(ticket, () => this._setLoading(true));
    this._commitStep(ticket, () => {
      this._setProgress(0);
      this._commitErrorInfo(null);
      this._setError(null);
    });

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
        // Guarded: a superseded / disposed upload's late progress writes nothing.
        this._commitStep(ticket, () => {
          if (event.lengthComputable) {
            this._setProgress(Math.round((event.loaded / event.total) * 100));
          }
        });
      });

      xhr.addEventListener("load", () => {
        this._xhr = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          if (!this._lane.claimTerminal(ticket, "success")) { resolve(null); this._lane.finalize(ticket); return; }
          let value: any = xhr.responseText;
          const contentType = xhr.getResponseHeader("Content-Type") || "";
          if (contentType.includes("application/json")) {
            try { value = JSON.parse(xhr.responseText); } catch { /* テキストのまま */ }
          }
          this._commitStep(ticket, () => this._setProgress(100));
          this._commitStep(ticket, () => this._setResponse(value, xhr.status));
          this._commitStep(ticket, () => this._setLoading(false));
          this._lane.finalize(ticket);
          resolve(value);
        } else {
          if (!this._lane.claimTerminal(ticket, "error")) { resolve(null); this._lane.finalize(ticket); return; }
          const error = { status: xhr.status, statusText: xhr.statusText, body: xhr.responseText };
          this._commitStep(ticket, () => {
            this._status = xhr.status; // HTTP error keeps status (no wcs-upload:response — value not reset)
            this._setErrorInfo(WCS_UPLOAD_ERROR_CODE.HttpError, "execute", true, `HTTP ${xhr.status} ${xhr.statusText}`);
            this._setError(error);
          });
          this._commitStep(ticket, () => this._setLoading(false));
          this._lane.finalize(ticket);
          resolve(null);
        }
      });

      xhr.addEventListener("error", () => {
        this._xhr = null;
        if (!this._lane.claimTerminal(ticket, "error")) { resolve(null); this._lane.finalize(ticket); return; }
        const message = "Network error";
        this._commitStep(ticket, () => {
          this._setErrorInfo(WCS_UPLOAD_ERROR_CODE.Network, "execute", true, message);
          this._setError({ message });
        });
        this._commitStep(ticket, () => this._setLoading(false));
        this._lane.finalize(ticket);
        resolve(null);
      });

      xhr.addEventListener("abort", () => {
        this._xhr = null;
        // abort is a routine cancellation, not a failure: claim the `aborted`
        // terminal and clear loading only (no error/errorInfo). A superseded /
        // disposed ticket fails the claim and drops.
        if (this._lane.claimTerminal(ticket, "aborted")) {
          this._commitStep(ticket, () => this._setLoading(false));
        }
        this._lane.finalize(ticket);
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

import { CredentialGetOptions, IWcBindable, StorableCredential } from "../types.js";
import { OperationLane, OperationTicket } from "./operationLane.js";
import {
  PlatformAssessment,
  WcsIoErrorInfo,
  WcsIoErrorPhase,
  assessCapabilities,
  requiredCapabilitiesAvailable,
} from "./platformCapability.js";
import { CREDENTIAL_CAPABILITIES, WCS_CREDENTIAL_ERROR_CODE } from "./credentialCapabilities.js";

/**
 * Headless Credential Management primitive. A thin, framework-agnostic wrapper
 * around `navigator.credentials.get()`/`.store()` exposed through the wc-bindable
 * protocol.
 *
 * Concurrency is owned by the shared `OperationLane` (io-core) with the `latest`
 * policy — **`get()` and `store()` share one lane**. A later call supersedes the
 * earlier one (the earlier completion fails the terminal CAS), preserving the v1
 * "single generation" behavior (docs/multi-promise-io-node-design.md): these two
 * operations are used sequentially in real auth flows (store after login, get
 * before one), not naturally concurrently on the same instance. If both ARE
 * invoked concurrently, the later call's result wins; use two separate
 * `<wcs-credential>` instances if that bites. The lane runs with
 * `withSignal: false` — the Credential Management API takes no `AbortSignal`;
 * dispose() invalidates any in-flight call via the owner generation.
 *
 * **v1 scope excludes WebAuthn (`publicKey`)** (docs/credential-tag-design.md §0):
 * `get()` validates+strips a `publicKey` option and `store()` rejects a
 * `PublicKeyCredential`, surfacing the attempt as a scope-violation `error`
 * (`errorInfo.code === "out-of-scope"`) rather than a WebAuthn backdoor.
 *
 * Note the cancellation signal is **`NotAllowedError`, NOT `AbortError`**: unlike
 * Web Share / Contact Picker, `credentials.get()/store()` reject with
 * `NotAllowedError` when the user dismisses the native chooser. That maps to
 * `cancelled`; every other name flows to `error`/`errorInfo`.
 */
export class CredentialCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "value", event: "wcs-credential:complete", getter: (e: Event) => (e as CustomEvent).detail.value },
      { name: "loading", event: "wcs-credential:loading-changed" },
      { name: "error", event: "wcs-credential:error" },
      { name: "cancelled", event: "wcs-credential:cancelled-changed" },
      // Serializable failure taxonomy (stable code / phase / recoverable), or null.
      // Additive bindable output; the existing `error` property/event are unchanged.
      // Fires its own `wcs-credential:error-info-changed` event; no getter, so the
      // bound value is the event detail (mirrors `error` / `loading` / `cancelled`).
      { name: "errorInfo", event: "wcs-credential:error-info-changed" },
    ],
    commands: [
      { name: "get", async: true },
      { name: "store", async: true },
    ],
  };

  // Required capability (probed at call time, never at module eval).
  private static readonly REQUIRED_CAPABILITIES = ["web.credentials"] as const;

  private _target: EventTarget;
  private _value: Credential | null = null;
  private _loading: boolean = false;
  private _error: any = null;
  private _cancelled: boolean = false;
  private _errorInfo: WcsIoErrorInfo | null = null;
  // Concurrency lane (io-core), shared by get() and store(). `latest`: a later
  // call supersedes the earlier. `withSignal: false`: the API takes no AbortSignal.
  private _lane = new OperationLane("credential", "latest", { withSignal: false });
  // SSR (§3.8): no asynchronous probe to await, so readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  get value(): Credential | null {
    return this._value;
  }

  get loading(): boolean {
    return this._loading;
  }

  get error(): any {
    return this._error;
  }

  get cancelled(): boolean {
    return this._cancelled;
  }

  /**
   * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
   * `recoverable` / `capabilityId`), or null. Exposed as an additive wc-bindable
   * property (event `wcs-credential:error-info-changed`); the existing `error`
   * property/event are unchanged. A `NotAllowedError` user cancellation is
   * `cancelled`, not `errorInfo`.
   */
  get errorInfo(): WcsIoErrorInfo | null {
    return this._errorInfo;
  }

  /**
   * Whether the required platform capability (`web.credentials`) is available right
   * now — decided by call-time feature detection, not User-Agent. Core-only,
   * additive.
   */
  get supported(): boolean {
    return requiredCapabilitiesAvailable(this.platformAssessment, CredentialCore.REQUIRED_CAPABILITIES);
  }

  /**
   * Full platform assessment (availability / readiness / preconditions), probed at
   * call time. Core-only opt-in dev / sidecar view.
   */
  get platformAssessment(): PlatformAssessment {
    return assessCapabilities(CREDENTIAL_CAPABILITIES, {
      required: CredentialCore.REQUIRED_CAPABILITIES,
      activity: this._loading ? "active" : "inactive",
      lastError: this._errorInfo ?? undefined,
    });
  }

  // Lifecycle (§3.5). Command-driven with no subscription to establish, so
  // observe() is an idempotent no-op that resolves once ready; dispose() bumps the
  // lane's owner generation, invalidating any in-flight get()/store().
  observe(): Promise<void> {
    return this._ready;
  }

  dispose(): void {
    this._lane.disposeOwner();
  }

  // CommitGuard (§5.1): external setters / event dispatch only run if the ticket
  // still holds owner generation, is pre-terminal, and is the lane's latest epoch
  // (a superseding get()/store() can invalidate a ticket mid-commit).
  private _commitStep(ticket: OperationTicket, step: () => void): void {
    if (this._lane.canCommit(ticket)) {
      step();
    }
  }

  private _setLoading(loading: boolean): void {
    if (this._loading === loading) return;
    this._loading = loading;
    this._target.dispatchEvent(new CustomEvent("wcs-credential:loading-changed", {
      detail: loading,
      bubbles: true,
    }));
  }

  // Deliberately NO same-value guard (unlike error/loading/cancelled below).
  // `value` is a success-completion signal, not idempotent state: it is written
  // only on a successful get()/store(), and wcs-credential:complete is the *sole*
  // success notification (store() echoes the caller's credential, so two successful
  // store() calls with the same object reference are two distinct completions). This
  // matches ShareCore `_setValue` / clipboard `_setRead`.
  private _setValue(value: Credential | null): void {
    this._value = value;
    this._target.dispatchEvent(new CustomEvent("wcs-credential:complete", {
      detail: { value },
      bubbles: true,
    }));
  }

  private _setError(error: any): void {
    if (this._error === error) return;
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-credential:error", {
      detail: error,
      bubbles: true,
    }));
  }

  private _setCancelled(cancelled: boolean): void {
    if (this._cancelled === cancelled) return;
    this._cancelled = cancelled;
    this._target.dispatchEvent(new CustomEvent("wcs-credential:cancelled-changed", {
      detail: cancelled,
      bubbles: true,
    }));
  }

  // Single mutation point for `errorInfo`, mirroring `_setError`'s same-value guard
  // and event dispatch so the additive `errorInfo` wc-bindable property stays in
  // sync with `error`. Each failure builds a fresh object (reference guard passes);
  // the clear path passes null (suppresses a redundant null→null per call start).
  private _setErrorInfo(code: string, phase: WcsIoErrorPhase, recoverable: boolean, message: string, capabilityId?: string): void {
    this._commitErrorInfo({ code, phase, recoverable, message, ...(capabilityId === undefined ? {} : { capabilityId }) });
  }

  private _commitErrorInfo(info: WcsIoErrorInfo | null): void {
    if (this._errorInfo === info) return;
    this._errorInfo = info;
    this._target.dispatchEvent(new CustomEvent("wcs-credential:error-info-changed", {
      detail: info,
      bubbles: true,
    }));
  }

  // Normalizes a rejection reason to a consistent { name, message } shape,
  // mirroring WorkerCore._normalizeError (packages/worker/src/core/WorkerCore.ts).
  private _normalizeError(e: unknown): { name: string; message: string } {
    if (e instanceof Error) {
      return { name: e.name, message: e.message };
    }
    return { name: "Error", message: String(e) };
  }

  // Classifies a get()/store() rejection as a user cancellation vs a real failure.
  // The Credential Management API rejects with `NotAllowedError` when the user
  // dismisses/declines the native chooser — a routine "the user did not pick"
  // outcome, mapped to `cancelled` and kept out of `error`/`errorInfo`. This is
  // `NotAllowedError`, NOT `AbortError` (unlike Web Share / Contact Picker). Every
  // other name (SecurityError, NetworkError, etc.) flows to `error`.
  private _isCancellation(e: unknown): boolean {
    return (e as { name?: unknown } | null)?.name === "NotAllowedError";
  }

  // Shared lane flow for get()/store() (both `latest` on the same lane). `op`
  // performs the platform call and returns the value to publish on success.
  private async _run(op: () => Promise<Credential | null>): Promise<Credential | null> {
    // `latest`: advance the epoch (supersede any in-flight get()/store()).
    const started = this._lane.begin()!;
    const { ticket } = started;

    this._commitStep(ticket, () => this._setLoading(true));
    // Reset the previous outcome before starting so a stale cancelled/error/
    // errorInfo does not linger into this call's result.
    this._commitStep(ticket, () => {
      this._commitErrorInfo(null);
      this._setError(null);
      this._setCancelled(false);
    });

    try {
      const value = await op();
      // Terminal CAS: a stale (superseded / dispose-invalidated) completion loses
      // the claim and is dropped without writing state.
      if (!this._lane.claimTerminal(ticket, "success")) {
        return null;
      }
      // Separate commit steps (like FetchCore): if `_setValue`'s event listener
      // synchronously supersedes this op, the following `_setLoading(false)` is
      // stopped by the commit guard rather than clobbering the newer op.
      this._commitStep(ticket, () => this._setValue(value));
      this._commitStep(ticket, () => this._setLoading(false));
      this._lane.finalize(ticket);
      return value;
    } catch (e: any) {
      const cancelled = this._isCancellation(e);
      if (!this._lane.claimTerminal(ticket, cancelled ? "aborted" : "error")) {
        return null;
      }
      this._commitStep(ticket, () => {
        if (cancelled) {
          this._setCancelled(true);
        } else {
          const norm = this._normalizeError(e);
          this._setErrorInfo(WCS_CREDENTIAL_ERROR_CODE.CredentialFailed, "execute", true, norm.message);
          this._setError(norm);
        }
      });
      this._commitStep(ticket, () => this._setLoading(false));
      this._lane.finalize(ticket);
      return null;
    }
  }

  /**
   * `get(options)` — v1 scope excludes `publicKey` (WebAuthn). If present, it is
   * stripped and the call surfaces a scope-violation `error` instead of forwarding
   * it to the platform API. `navigator.credentials.get()` does not require a user
   * gesture, so this can be invoked automatically on page load for silent sign-in.
   */
  async get(options: CredentialGetOptions & { publicKey?: unknown } = {}): Promise<Credential | null> {
    if ("publicKey" in options) {
      const message = "WebAuthn (publicKey) is out of scope for @wcstack/credential v1. Use a dedicated WebAuthn node instead.";
      this._setErrorInfo(WCS_CREDENTIAL_ERROR_CODE.OutOfScope, "start", false, message);
      this._setError({ name: "NotSupportedError", message });
      return null;
    }

    const assessment = this.platformAssessment;
    if (!requiredCapabilitiesAvailable(assessment, CredentialCore.REQUIRED_CAPABILITIES)) {
      const missing = CredentialCore.REQUIRED_CAPABILITIES.find((id) => assessment.availability.get(id) !== "available");
      const message = "Credential Management API is not supported in this browser.";
      this._setErrorInfo(WCS_CREDENTIAL_ERROR_CODE.CapabilityMissing, "start", false, message, missing);
      this._setError({ message });
      return null;
    }

    const nav = (globalThis as { navigator?: { credentials?: CredentialsContainer } }).navigator!;
    return this._run(() => nav.credentials!.get(options as CredentialRequestOptions));
  }

  /**
   * `store(credential)` — shares the same single lane as `get()`.
   * `navigator.credentials.store()` resolves `Promise<void>`, so `value` is
   * synthesized as an echo of the caller's `credential`. A `PublicKeyCredential`
   * (`type === "public-key"`, WebAuthn) is rejected as a scope violation before
   * touching the platform API.
   */
  async store(credential: StorableCredential): Promise<Credential | null> {
    if ((credential as { type?: unknown } | null)?.type === "public-key") {
      const message = "WebAuthn (publicKey) credentials are out of scope for @wcstack/credential v1. Use a dedicated WebAuthn node instead.";
      this._setErrorInfo(WCS_CREDENTIAL_ERROR_CODE.OutOfScope, "start", false, message);
      this._setError({ name: "NotSupportedError", message });
      return null;
    }

    const assessment = this.platformAssessment;
    if (!requiredCapabilitiesAvailable(assessment, CredentialCore.REQUIRED_CAPABILITIES)) {
      const missing = CredentialCore.REQUIRED_CAPABILITIES.find((id) => assessment.availability.get(id) !== "available");
      const message = "Credential Management API is not supported in this browser.";
      this._setErrorInfo(WCS_CREDENTIAL_ERROR_CODE.CapabilityMissing, "start", false, message, missing);
      this._setError({ message });
      return null;
    }

    const nav = (globalThis as { navigator?: { credentials?: CredentialsContainer } }).navigator!;
    return this._run(async () => {
      await nav.credentials!.store(credential);
      return credential;
    });
  }
}

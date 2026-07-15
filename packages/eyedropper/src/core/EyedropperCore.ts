import { IWcBindable, WcsEyedropperData } from "../types.js";
import { OperationLane, OperationTicket } from "./operationLane.js";
import {
  PlatformAssessment,
  WcsIoErrorInfo,
  WcsIoErrorPhase,
  assessCapabilities,
  requiredCapabilitiesAvailable,
} from "./platformCapability.js";
import { EYEDROPPER_CAPABILITIES, WCS_EYEDROPPER_ERROR_CODE } from "./eyedropperCapabilities.js";

/**
 * Headless EyeDropper primitive. A thin, framework-agnostic wrapper around
 * `new EyeDropper().open(options)` exposed through the wc-bindable protocol.
 *
 * Concurrency is owned by the shared `OperationLane` (io-core) with the `latest`
 * policy: `EyeDropper.open()` accepts a `{signal}`, so — unlike Web Share / Contact
 * Picker (exhaust) — a caller has a real platform mechanism to cancel an in-flight
 * pick. A new `open()` supersedes the previous one (the lane aborts its
 * AbortController and the superseded completion fails the terminal CAS), and the
 * `abort()` command aborts the active pick. This replaces the ad-hoc `_gen` +
 * `_abortController` + finally-block identity check with the same lane FetchCore
 * uses; the lane owns the per-attempt AbortController and the commit guard.
 *
 * Both the user dismissing the picker with Escape and the caller invoking
 * `abort()` reject `open()` with the same `AbortError` — both land on `cancelled`
 * without distinction (docs/eyedropper-tag-design.md §2).
 */
export class EyedropperCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "value", event: "wcs-eyedropper:complete", getter: (e: Event) => (e as CustomEvent).detail.value },
      { name: "loading", event: "wcs-eyedropper:loading-changed" },
      { name: "error", event: "wcs-eyedropper:error" },
      { name: "cancelled", event: "wcs-eyedropper:cancelled-changed" },
      // Serializable failure taxonomy (stable code / phase / recoverable), or null.
      // Additive bindable output; the existing `error` property/event are unchanged.
      // Fires its own `wcs-eyedropper:error-info-changed` event; no getter, so the
      // bound value is the event detail (mirrors `error` / `loading` / `cancelled`).
      { name: "errorInfo", event: "wcs-eyedropper:error-info-changed" },
    ],
    commands: [
      { name: "open", async: true },
      { name: "abort" },
    ],
  };

  // Required capability (probed at call time, never at module eval).
  private static readonly REQUIRED_CAPABILITIES = ["web.eyedropper"] as const;

  private _target: EventTarget;
  private _value: WcsEyedropperData | null = null;
  private _loading: boolean = false;
  private _error: any = null;
  private _cancelled: boolean = false;
  private _errorInfo: WcsIoErrorInfo | null = null;
  // Concurrency lane (io-core). `latest`: a new open() supersedes + aborts the
  // in-flight one (switchMap). `withSignal: true`: the lane owns the per-attempt
  // AbortController whose signal is passed to EyeDropper.open(). dispose() bumps
  // the owner generation and aborts.
  private _lane = new OperationLane("eyedropper", "latest", { withSignal: true });
  // SSR (§3.8): no asynchronous probe to await, so readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  get value(): WcsEyedropperData | null {
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
   * property (event `wcs-eyedropper:error-info-changed`); the existing `error`
   * property/event are unchanged. Note user/abort cancellation is `cancelled`, not
   * `errorInfo`.
   */
  get errorInfo(): WcsIoErrorInfo | null {
    return this._errorInfo;
  }

  /**
   * Whether the required platform capability (`web.eyedropper`) is available right
   * now — decided by call-time feature detection, not User-Agent. Core-only,
   * additive.
   */
  get supported(): boolean {
    return requiredCapabilitiesAvailable(this.platformAssessment, EyedropperCore.REQUIRED_CAPABILITIES);
  }

  /**
   * Full platform assessment (availability / readiness / preconditions), probed at
   * call time. Core-only opt-in dev / sidecar view.
   */
  get platformAssessment(): PlatformAssessment {
    return assessCapabilities(EYEDROPPER_CAPABILITIES, {
      required: EyedropperCore.REQUIRED_CAPABILITIES,
      activity: this._loading ? "active" : "inactive",
      lastError: this._errorInfo ?? undefined,
    });
  }

  // Lifecycle (§3.5). EyeDropper is command-driven with no subscription to
  // establish, so observe() is an idempotent no-op that resolves once ready;
  // dispose() bumps the lane's owner generation (invalidating any in-flight open())
  // and aborts its AbortController.
  observe(): Promise<void> {
    return this._ready;
  }

  dispose(): void {
    this._lane.disposeOwner();
  }

  // CommitGuard (§5.1): external setters / event dispatch only run if the ticket
  // still holds owner generation, is pre-terminal, and is the lane's latest epoch
  // (a superseding open() can invalidate a ticket mid-commit).
  private _commitStep(ticket: OperationTicket, step: () => void): void {
    if (this._lane.canCommit(ticket)) {
      step();
    }
  }

  private _setLoading(loading: boolean): void {
    if (this._loading === loading) return;
    this._loading = loading;
    this._target.dispatchEvent(new CustomEvent("wcs-eyedropper:loading-changed", {
      detail: loading,
      bubbles: true,
    }));
  }

  private _setValue(value: WcsEyedropperData | null): void {
    if (this._value === value) return;
    this._value = value;
    this._target.dispatchEvent(new CustomEvent("wcs-eyedropper:complete", {
      detail: { value },
      bubbles: true,
    }));
  }

  private _setError(error: any): void {
    if (this._error === error) return;
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-eyedropper:error", {
      detail: error,
      bubbles: true,
    }));
  }

  private _setCancelled(cancelled: boolean): void {
    if (this._cancelled === cancelled) return;
    this._cancelled = cancelled;
    this._target.dispatchEvent(new CustomEvent("wcs-eyedropper:cancelled-changed", {
      detail: cancelled,
      bubbles: true,
    }));
  }

  // Single mutation point for `errorInfo`, mirroring `_setError`'s same-value guard
  // and event dispatch so the additive `errorInfo` wc-bindable property stays in
  // sync with `error`. Each failure builds a fresh object (reference guard passes);
  // the clear path passes null (suppresses a redundant null→null per open start).
  private _setErrorInfo(code: string, phase: WcsIoErrorPhase, recoverable: boolean, message: string, capabilityId?: string): void {
    this._commitErrorInfo({ code, phase, recoverable, message, ...(capabilityId === undefined ? {} : { capabilityId }) });
  }

  private _commitErrorInfo(info: WcsIoErrorInfo | null): void {
    if (this._errorInfo === info) return;
    this._errorInfo = info;
    this._target.dispatchEvent(new CustomEvent("wcs-eyedropper:error-info-changed", {
      detail: info,
      bubbles: true,
    }));
  }

  /**
   * Cancels an in-flight `open()` call, if any (a no-op otherwise). Aborts the
   * lane's active AbortController — the in-flight open() then rejects with
   * `AbortError` and lands on `cancelled`. The epoch is not advanced, so the
   * aborted operation keeps eligibility to claim the `aborted` terminal.
   */
  abort(): void {
    this._lane.abortActive();
  }

  async open(): Promise<WcsEyedropperData | null> {
    // never-throw + unsupported (§4 / §7.2): probe the required capability at call
    // time (non-Chromium browsers lack this API). If `web.eyedropper` is absent, do
    // NOT start — surface a stable `capability-missing` taxonomy and the existing
    // error message shape.
    const assessment = this.platformAssessment;
    if (!requiredCapabilitiesAvailable(assessment, EyedropperCore.REQUIRED_CAPABILITIES)) {
      const missing = EyedropperCore.REQUIRED_CAPABILITIES.find((id) => assessment.availability.get(id) !== "available");
      const message = "EyeDropper API is not supported in this browser.";
      this._setErrorInfo(WCS_EYEDROPPER_ERROR_CODE.CapabilityMissing, "start", false, message, missing);
      this._setError({ message });
      return null;
    }

    // `latest`: advance the epoch and abort the previous in-flight pick (supersede).
    // begin() never returns null for latest.
    const started = this._lane.begin()!;
    const { ticket, attempt } = started;
    const signal = attempt.signal;

    // Capability probed above → EyeDropper is present. Resolve the constructor at
    // call time (never cached, §3.7) so tests can install/remove it freely.
    const EyeDropperCtor = (globalThis as { EyeDropper?: new () => { open(options?: { signal?: AbortSignal }): Promise<WcsEyedropperData> } }).EyeDropper!;

    this._commitStep(ticket, () => this._setLoading(true));
    // Reset the previous outcome before starting a new open() so a stale
    // cancelled/error/errorInfo does not linger into this call's result.
    this._commitStep(ticket, () => {
      this._commitErrorInfo(null);
      this._setError(null);
      this._setCancelled(false);
    });

    try {
      const result = await new EyeDropperCtor().open({ signal });
      // Terminal CAS: a stale (superseded / dispose-invalidated) completion loses
      // the claim and is dropped without writing state.
      if (!this._lane.claimTerminal(ticket, "success")) {
        return null;
      }
      // The platform's own result object ({ sRGBHex }) is used verbatim (§3).
      // Separate commit steps (like FetchCore): if `_setValue`'s event listener
      // synchronously supersedes this op, the following `_setLoading(false)` is
      // stopped by the commit guard rather than clobbering the newer op.
      this._commitStep(ticket, () => this._setValue(result));
      this._commitStep(ticket, () => this._setLoading(false));
      this._lane.finalize(ticket);
      return result;
    } catch (e: any) {
      const cancelled = e?.name === "AbortError";
      if (!this._lane.claimTerminal(ticket, cancelled ? "aborted" : "error")) {
        return null;
      }
      this._commitStep(ticket, () => {
        if (cancelled) {
          // Either the user dismissed the picker with Escape or the caller invoked
          // abort() — a routine cancellation, not a platform failure, and not
          // distinguished (§2). Kept out of `error`/`errorInfo`.
          this._setCancelled(true);
        } else {
          const message = String(e?.message ?? "Color pick failed.");
          this._setErrorInfo(WCS_EYEDROPPER_ERROR_CODE.PickFailed, "execute", true, message);
          this._setError(e ?? { message });
        }
      });
      this._commitStep(ticket, () => this._setLoading(false));
      this._lane.finalize(ticket);
      return null;
    }
  }
}

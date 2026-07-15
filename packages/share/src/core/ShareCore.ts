import { IWcBindable, WcsShareData } from "../types.js";
import { OperationLane } from "./operationLane.js";
import {
  PlatformAssessment,
  WcsIoErrorInfo,
  WcsIoErrorPhase,
  assessCapabilities,
  requiredCapabilitiesAvailable,
} from "./platformCapability.js";
import { SHARE_CAPABILITIES, WCS_SHARE_ERROR_CODE } from "./shareCapabilities.js";

/**
 * Headless Web Share primitive. A thin, framework-agnostic wrapper around
 * `navigator.share(data)` exposed through the wc-bindable protocol.
 *
 * Concurrency is owned by the shared `OperationLane` (io-core) with the `exhaust`
 * policy: a share dialog is a single system-modal surface, so while one share() is
 * in flight a new call is rejected as an idempotent no-op instead of starting a
 * second `navigator.share()`. This replaces the earlier dispose-only `_gen` guard,
 * which relied on the platform rejecting the second call with `InvalidStateError`
 * — but that let the rejected second call reset/overwrite the still-pending first
 * call's `error`/`loading` state. The lane's owner generation still invalidates any
 * in-flight share() on dispose() (a late resolve fails the commit guard).
 *
 * `navigator.share()` accepts no `AbortSignal` and there is no platform mechanism
 * to cancel an in-flight share dialog, so the lane runs with `withSignal: false`.
 */
export class ShareCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "value", event: "wcs-share:complete", getter: (e: Event) => (e as CustomEvent).detail.value },
      { name: "loading", event: "wcs-share:loading-changed" },
      { name: "error", event: "wcs-share:error" },
      { name: "cancelled", event: "wcs-share:cancelled-changed" },
      // Serializable failure taxonomy (stable code / phase / recoverable), or null.
      // Additive bindable output; the existing `error` property/event are unchanged.
      // Fires its own `wcs-share:error-info-changed` event; no getter, so the bound
      // value is the event detail (mirrors `error` / `loading` / `cancelled`).
      { name: "errorInfo", event: "wcs-share:error-info-changed" },
    ],
    commands: [
      { name: "share", async: true },
    ],
  };

  // Required capability (probed at call time, never at module eval). `web.share`
  // is the only required API; there is no optional/degraded surface for share.
  private static readonly REQUIRED_CAPABILITIES = ["web.share"] as const;

  private _target: EventTarget;
  private _value: WcsShareData | null = null;
  private _loading: boolean = false;
  private _error: any = null;
  private _cancelled: boolean = false;
  private _errorInfo: WcsIoErrorInfo | null = null;
  // Concurrency lane (io-core). `exhaust`: only one share dialog at a time — a new
  // begin() while active returns null (idempotent no-op). `withSignal: false`:
  // navigator.share() has no AbortSignal. dispose() bumps the owner generation.
  private _lane = new OperationLane("share", "exhaust", { withSignal: false });
  // SSR (§3.8): no asynchronous probe to await, so readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  get value(): WcsShareData | null {
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
   * property (event `wcs-share:error-info-changed`); the existing `error`
   * property/event are unchanged.
   */
  get errorInfo(): WcsIoErrorInfo | null {
    return this._errorInfo;
  }

  /**
   * Whether the required platform capability (`web.share`) is available right now —
   * decided by call-time feature detection, not User-Agent. Core-only, additive.
   */
  get supported(): boolean {
    return requiredCapabilitiesAvailable(this.platformAssessment, ShareCore.REQUIRED_CAPABILITIES);
  }

  /**
   * Full platform assessment (availability / readiness / preconditions), probed at
   * call time. Core-only opt-in dev / sidecar view.
   */
  get platformAssessment(): PlatformAssessment {
    return assessCapabilities(SHARE_CAPABILITIES, {
      required: ShareCore.REQUIRED_CAPABILITIES,
      activity: this._loading ? "active" : "inactive",
      lastError: this._errorInfo ?? undefined,
    });
  }

  // Lifecycle (§3.5). Share is command-driven with no subscription to establish,
  // so observe() is an idempotent no-op that resolves once ready; dispose() bumps
  // the lane's owner generation, invalidating any in-flight share() (a late resolve
  // then fails the commit guard). There is nothing to abort or unsubscribe.
  observe(): Promise<void> {
    return this._ready;
  }

  dispose(): void {
    this._lane.disposeOwner();
  }

  private _setLoading(loading: boolean): void {
    if (this._loading === loading) return;
    this._loading = loading;
    this._target.dispatchEvent(new CustomEvent("wcs-share:loading-changed", {
      detail: loading,
      bubbles: true,
    }));
  }

  // Deliberately NO same-value guard (unlike error/loading/cancelled below).
  // `value` is a success-completion signal, not idempotent state: it is written
  // only on a successful share(), and wcs-share:complete is the *sole* success
  // notification. Two consecutive successful shares — even with the same `data`
  // object reference, or a data-less share echoing null when value is already
  // null — are two distinct completions and must each re-fire wcs-share:complete
  // so an `$on`/eventToken consumer (and a `value:` binding) sees every success.
  // This matches clipboard `_setRead` / broadcast `_setMessage`, which carve
  // result/event values out of the §3.3 guard for the same reason.
  private _setValue(value: WcsShareData | null): void {
    this._value = value;
    this._target.dispatchEvent(new CustomEvent("wcs-share:complete", {
      detail: { value },
      bubbles: true,
    }));
  }

  private _setError(error: any): void {
    if (this._error === error) return;
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-share:error", {
      detail: error,
      bubbles: true,
    }));
  }

  private _setCancelled(cancelled: boolean): void {
    if (this._cancelled === cancelled) return;
    this._cancelled = cancelled;
    this._target.dispatchEvent(new CustomEvent("wcs-share:cancelled-changed", {
      detail: cancelled,
      bubbles: true,
    }));
  }

  // Single mutation point for `errorInfo`, mirroring `_setError`'s same-value guard
  // and event dispatch so the additive `errorInfo` wc-bindable property stays in
  // sync with `error`. Each failure builds a fresh object (reference guard passes);
  // the clear path passes null (suppresses a redundant null→null per share start).
  private _setErrorInfo(code: string, phase: WcsIoErrorPhase, recoverable: boolean, message: string, capabilityId?: string): void {
    this._commitErrorInfo({ code, phase, recoverable, message, ...(capabilityId === undefined ? {} : { capabilityId }) });
  }

  private _commitErrorInfo(info: WcsIoErrorInfo | null): void {
    if (this._errorInfo === info) return;
    this._errorInfo = info;
    this._target.dispatchEvent(new CustomEvent("wcs-share:error-info-changed", {
      detail: info,
      bubbles: true,
    }));
  }

  async share(data?: WcsShareData): Promise<WcsShareData | null> {
    // never-throw + unsupported (§8 / §7.2): probe the required capability at call
    // time. If `web.share` is absent, do NOT start — surface a stable
    // `capability-missing` taxonomy and the existing error message shape.
    const assessment = this.platformAssessment;
    if (!requiredCapabilitiesAvailable(assessment, ShareCore.REQUIRED_CAPABILITIES)) {
      const missing = ShareCore.REQUIRED_CAPABILITIES.find((id) => assessment.availability.get(id) !== "available");
      const message = "Web Share API is not supported in this browser.";
      this._setErrorInfo(WCS_SHARE_ERROR_CODE.CapabilityMissing, "start", false, message, missing);
      this._setError({ message });
      return null;
    }

    // exhaust: a share dialog is already open → reject this call as an idempotent
    // no-op instead of racing a second navigator.share() (which would reject and
    // corrupt the in-flight call's result). begin() returns null when active.
    const started = this._lane.begin();
    if (started === null) {
      return null;
    }
    const { ticket } = started;

    // Capability probed above → navigator.share is present. Resolve + bind at call
    // time (never cached, §3.7) so tests can install/remove it freely.
    const nav = (globalThis as { navigator?: { share?: (data?: WcsShareData) => Promise<void> } }).navigator!;
    const shareFn = nav.share!.bind(nav);

    // Start phase runs synchronously on a fresh ticket (no dispose can interleave
    // before the first await), so these setters are unconditional. Post-await
    // setters are gated by the lane's terminal CAS (claimTerminal), which fails on
    // a stale/disposed ticket — share (exhaust, no supersede/timeout) needs no
    // per-setter commit guard (unlike FetchCore's `latest` lane).
    this._setLoading(true);
    // Reset the previous outcome before starting a new share so a stale
    // cancelled/error/errorInfo does not linger into this call's result (§3).
    this._commitErrorInfo(null);
    this._setError(null);
    this._setCancelled(false);

    try {
      await shareFn(data);
      // Terminal CAS: a stale (dispose-invalidated) completion loses the claim.
      if (!this._lane.claimTerminal(ticket, "success")) {
        return null;
      }
      // navigator.share() resolves `Promise<void>` — there is no payload to read
      // off the API, so `value` is synthesized as an echo of the caller's `data`,
      // signalling "this share completed successfully" (§4).
      this._setValue(data ?? null);
      this._setLoading(false);
      this._lane.finalize(ticket);
      return data ?? null;
    } catch (e: any) {
      const cancelled = e?.name === "AbortError";
      if (!this._lane.claimTerminal(ticket, cancelled ? "aborted" : "error")) {
        return null;
      }
      if (cancelled) {
        // The user dismissed the share sheet — a routine cancellation, not a
        // platform failure. Kept out of `error`/`errorInfo` (§3).
        this._setCancelled(true);
      } else {
        const message = String(e?.message ?? "Share failed.");
        this._setErrorInfo(WCS_SHARE_ERROR_CODE.ShareFailed, "execute", true, message);
        this._setError(e ?? { message });
      }
      this._setLoading(false);
      this._lane.finalize(ticket);
      return null;
    }
  }
}

import { ContactInfo, ContactProperty, ContactsSelectOptions, IWcBindable } from "../types.js";
import { OperationLane } from "./operationLane.js";
import {
  PlatformAssessment,
  WcsIoErrorInfo,
  WcsIoErrorPhase,
  assessCapabilities,
  requiredCapabilitiesAvailable,
} from "./platformCapability.js";
import { CONTACTS_CAPABILITIES, WCS_CONTACTS_ERROR_CODE } from "./contactsCapabilities.js";

/**
 * Headless Contact Picker primitive. A thin, framework-agnostic wrapper around
 * `navigator.contacts.select(properties, options)` exposed through the
 * wc-bindable protocol.
 *
 * Concurrency is owned by the shared `OperationLane` (io-core) with the `exhaust`
 * policy: the contact picker is a single system-modal surface, so while one
 * select() is in flight a new call is rejected as an idempotent no-op instead of
 * starting a second `navigator.contacts.select()`. This replaces the earlier
 * dispose-only `_gen` guard, which relied on the platform rejecting the second call
 * with `InvalidStateError` — but that let the rejected second call reset/overwrite
 * the still-pending first call's `error`/`loading` state. The lane's owner
 * generation still invalidates any in-flight select() on dispose().
 *
 * The Contact Picker API accepts no `AbortSignal`, so the lane runs with
 * `withSignal: false`. `select()` takes **two** positional arguments
 * (`properties`, `options`) rather than one — the command-token argument
 * pass-through does not special-case argument count, so this requires no protocol
 * change.
 */
export class ContactsCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "value", event: "wcs-contacts:complete", getter: (e: Event) => (e as CustomEvent).detail.value },
      { name: "loading", event: "wcs-contacts:loading-changed" },
      { name: "error", event: "wcs-contacts:error" },
      { name: "cancelled", event: "wcs-contacts:cancelled-changed" },
      // Serializable failure taxonomy (stable code / phase / recoverable), or null.
      // Additive bindable output; the existing `error` property/event are unchanged.
      // Fires its own `wcs-contacts:error-info-changed` event; no getter, so the
      // bound value is the event detail (mirrors `error` / `loading` / `cancelled`).
      { name: "errorInfo", event: "wcs-contacts:error-info-changed" },
    ],
    commands: [
      { name: "select", async: true },
    ],
  };

  // Required capability (probed at call time, never at module eval).
  private static readonly REQUIRED_CAPABILITIES = ["web.contacts"] as const;

  private _target: EventTarget;
  private _value: ContactInfo[] | null = null;
  private _loading: boolean = false;
  private _error: any = null;
  private _cancelled: boolean = false;
  private _errorInfo: WcsIoErrorInfo | null = null;
  // Concurrency lane (io-core). `exhaust`: only one picker at a time — a new begin()
  // while active returns null (idempotent no-op). `withSignal: false`:
  // navigator.contacts.select() has no AbortSignal. dispose() bumps the owner gen.
  private _lane = new OperationLane("contacts", "exhaust", { withSignal: false });
  // SSR (§3.8): no asynchronous probe to await, so readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  get value(): ContactInfo[] | null {
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
   * property (event `wcs-contacts:error-info-changed`); the existing `error`
   * property/event are unchanged.
   */
  get errorInfo(): WcsIoErrorInfo | null {
    return this._errorInfo;
  }

  /**
   * Whether the required platform capability (`web.contacts`) is available right
   * now — decided by call-time feature detection, not User-Agent. Core-only,
   * additive.
   */
  get supported(): boolean {
    return requiredCapabilitiesAvailable(this.platformAssessment, ContactsCore.REQUIRED_CAPABILITIES);
  }

  /**
   * Full platform assessment (availability / readiness / preconditions), probed at
   * call time. Core-only opt-in dev / sidecar view.
   */
  get platformAssessment(): PlatformAssessment {
    return assessCapabilities(CONTACTS_CAPABILITIES, {
      required: ContactsCore.REQUIRED_CAPABILITIES,
      activity: this._loading ? "active" : "inactive",
      lastError: this._errorInfo ?? undefined,
    });
  }

  // Lifecycle (§3.5). Select is command-driven with no subscription to establish,
  // so observe() is an idempotent no-op that resolves once ready; dispose() bumps
  // the lane's owner generation, invalidating any in-flight select() (a late
  // resolve then fails the terminal CAS). There is nothing to abort or unsubscribe.
  observe(): Promise<void> {
    return this._ready;
  }

  dispose(): void {
    this._lane.disposeOwner();
  }

  private _setLoading(loading: boolean): void {
    if (this._loading === loading) return;
    this._loading = loading;
    this._target.dispatchEvent(new CustomEvent("wcs-contacts:loading-changed", {
      detail: loading,
      bubbles: true,
    }));
  }

  private _setValue(value: ContactInfo[] | null): void {
    if (this._value === value) return;
    this._value = value;
    this._target.dispatchEvent(new CustomEvent("wcs-contacts:complete", {
      detail: { value },
      bubbles: true,
    }));
  }

  private _setError(error: any): void {
    if (this._error === error) return;
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-contacts:error", {
      detail: error,
      bubbles: true,
    }));
  }

  private _setCancelled(cancelled: boolean): void {
    if (this._cancelled === cancelled) return;
    this._cancelled = cancelled;
    this._target.dispatchEvent(new CustomEvent("wcs-contacts:cancelled-changed", {
      detail: cancelled,
      bubbles: true,
    }));
  }

  // Single mutation point for `errorInfo`, mirroring `_setError`'s same-value guard
  // and event dispatch so the additive `errorInfo` wc-bindable property stays in
  // sync with `error`. Each failure builds a fresh object (reference guard passes);
  // the clear path passes null (suppresses a redundant null→null per select start).
  private _setErrorInfo(code: string, phase: WcsIoErrorPhase, recoverable: boolean, message: string, capabilityId?: string): void {
    this._commitErrorInfo({ code, phase, recoverable, message, ...(capabilityId === undefined ? {} : { capabilityId }) });
  }

  private _commitErrorInfo(info: WcsIoErrorInfo | null): void {
    if (this._errorInfo === info) return;
    this._errorInfo = info;
    this._target.dispatchEvent(new CustomEvent("wcs-contacts:error-info-changed", {
      detail: info,
      bubbles: true,
    }));
  }

  async select(properties: ContactProperty[], options?: ContactsSelectOptions): Promise<ContactInfo[] | null> {
    // never-throw + unsupported (§7.2): probe the required capability at call time.
    // Desktop browsers entirely lack this API, so this is the common case. If
    // `web.contacts` is absent, do NOT start — surface a stable `capability-missing`
    // taxonomy and the existing error message shape.
    const assessment = this.platformAssessment;
    if (!requiredCapabilitiesAvailable(assessment, ContactsCore.REQUIRED_CAPABILITIES)) {
      const missing = ContactsCore.REQUIRED_CAPABILITIES.find((id) => assessment.availability.get(id) !== "available");
      const message = "Contact Picker API is not supported in this browser.";
      this._setErrorInfo(WCS_CONTACTS_ERROR_CODE.CapabilityMissing, "start", false, message, missing);
      this._setError({ message });
      return null;
    }

    // exhaust: a picker is already open → reject this call as an idempotent no-op
    // instead of racing a second select() (which would reject and corrupt the
    // in-flight call's result). begin() returns null when active.
    const started = this._lane.begin();
    if (started === null) {
      return null;
    }
    const { ticket } = started;

    // Capability probed above → navigator.contacts.select is present. Resolve + bind
    // at call time (never cached, §3.7) so tests can install/remove it freely.
    const nav = (globalThis as { navigator?: { contacts?: { select?: (properties: ContactProperty[], options?: ContactsSelectOptions) => Promise<ContactInfo[]> } } }).navigator!;
    const selectFn = nav.contacts!.select!.bind(nav.contacts);

    // Start phase runs synchronously on a fresh ticket (no dispose can interleave
    // before the first await), so these setters are unconditional. Post-await
    // setters are gated by the lane's terminal CAS (claimTerminal), which fails on
    // a stale/disposed ticket — contacts (exhaust, no supersede/timeout) needs no
    // per-setter commit guard (unlike FetchCore's `latest` lane).
    this._setLoading(true);
    // Reset the previous outcome before starting a new select so a stale
    // cancelled/error/errorInfo does not linger into this call's result.
    this._commitErrorInfo(null);
    this._setError(null);
    this._setCancelled(false);

    try {
      const contacts = await selectFn(properties, options);
      // Terminal CAS: a stale (dispose-invalidated) completion loses the claim.
      if (!this._lane.claimTerminal(ticket, "success")) {
        return null;
      }
      // `multiple` does not change the result shape — even a single selection
      // resolves to a one-element array (docs/contact-picker-tag-design.md §3).
      this._setValue(contacts);
      this._setLoading(false);
      this._lane.finalize(ticket);
      return contacts;
    } catch (e: any) {
      const cancelled = e?.name === "AbortError";
      if (!this._lane.claimTerminal(ticket, cancelled ? "aborted" : "error")) {
        return null;
      }
      if (cancelled) {
        // The user dismissed the contact picker — a routine cancellation, not a
        // platform failure. Kept out of `error`/`errorInfo`.
        this._setCancelled(true);
      } else {
        const message = String(e?.message ?? "Contact selection failed.");
        this._setErrorInfo(WCS_CONTACTS_ERROR_CODE.SelectFailed, "execute", true, message);
        this._setError(e ?? { message });
      }
      this._setLoading(false);
      this._lane.finalize(ticket);
      return null;
    }
  }
}

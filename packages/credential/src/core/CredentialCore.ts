import { CredentialGetOptions, IWcBindable, StorableCredential, WcsPasswordCredentialData } from "../types.js";
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
 *
 * **Password credentials are Chromium only.** Firefox and Safari have
 * `navigator.credentials` (for WebAuthn) and no `PasswordCredential`. A `get()` that
 * asks for `password` / `federated`, and every `store()`, is refused there as
 * `capability-missing` without calling the browser, and `supported` is false.
 * `preventSilentAccess()` (sign-out) is not on the lane and does nothing where the
 * method is missing.
 */
export class CredentialCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "value", event: "wcs-credential:complete", semantics: "state", getter: (e: Event) => (e as CustomEvent).detail.value },
      { name: "loading", event: "wcs-credential:loading-changed", semantics: "state" },
      { name: "error", event: "wcs-credential:error", semantics: "state" },
      { name: "cancelled", event: "wcs-credential:cancelled-changed", semantics: "state" },
      // Serializable failure taxonomy (stable code / phase / recoverable), or null.
      // Additive bindable output; the existing `error` property/event are unchanged.
      // Fires its own `wcs-credential:error-info-changed` event; no getter, so the
      // bound value is the event detail (mirrors `error` / `loading` / `cancelled`).
      { name: "errorInfo", event: "wcs-credential:error-info-changed", semantics: "state" },
      // Whether this page can use password credentials (`navigator.credentials` and
      // the `PasswordCredential` class). Computed at call time; the event carries the
      // boolean and fires from observe() when it differs from the last value
      // dispatched.
      { name: "supported", event: "wcs-credential:supported-changed", semantics: "state" },
    ],
    commands: [
      { name: "get", async: true },
      { name: "store", async: true },
      { name: "preventSilentAccess", async: true },
    ],
  };

  // Capabilities (probed at call time, never at module eval). Every command needs
  // the container; password / federated credentials — what this element is for —
  // need the `PasswordCredential` class as well.
  private static readonly CONTAINER_CAPABILITY = "web.credentials";
  private static readonly PASSWORD_CAPABILITY = "web.password-credential";
  private static readonly REQUIRED_CAPABILITIES = [
    CredentialCore.CONTAINER_CAPABILITY, CredentialCore.PASSWORD_CAPABILITY,
  ] as const;

  private _target: EventTarget;
  private _value: Credential | null = null;
  private _loading: boolean = false;
  private _error: any = null;
  private _cancelled: boolean = false;
  private _errorInfo: WcsIoErrorInfo | null = null;
  // `supported` as last dispatched (never the value itself — the getter probes at
  // call time). Starts at false, so observe() announces a page that has them.
  private _supportedPublished: boolean = false;
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
   * Whether this page can use password credentials right now: `navigator.credentials`
   * is there **and** `PasswordCredential` is a class — decided by call-time feature
   * detection, not User-Agent. False in Firefox and Safari, which have the container
   * (for WebAuthn) and no `PasswordCredential`. It does not say a credential is
   * saved, or that the user will choose one. A wc-bindable output (event
   * `wcs-credential:supported-changed`).
   */
  get supported(): boolean {
    return requiredCapabilitiesAvailable(this.platformAssessment, CredentialCore.REQUIRED_CAPABILITIES);
  }

  /**
   * Full platform assessment (availability / readiness / preconditions), probed at
   * call time. Core-only opt-in dev / sidecar view. Both capabilities are required:
   * without `PasswordCredential` the readiness is "idle".
   */
  get platformAssessment(): PlatformAssessment {
    return assessCapabilities(CREDENTIAL_CAPABILITIES, {
      required: CredentialCore.REQUIRED_CAPABILITIES,
      activity: this._loading ? "active" : "inactive",
      lastError: this._errorInfo ?? undefined,
    });
  }

  // Lifecycle (§3.5). Command-driven with no subscription to establish, so
  // observe() only publishes `supported` (when it differs from the last value
  // dispatched) and resolves once ready — idempotent; dispose() bumps the
  // lane's owner generation, invalidating any in-flight get()/store().
  observe(): Promise<void> {
    this._publishSupported();
    return this._ready;
  }

  dispose(): void {
    this._lane.disposeOwner();
    // The operation the lane drops settles nothing any more, so its end is published
    // here (timing-and-firing-contract §22): a route the element leaves keeps its
    // nodes — bindings included — for the next entry, and state would keep `loading`.
    this._setLoading(false);
  }

  // CommitGuard (§5.1): external setters / event dispatch only run if the ticket
  // still holds owner generation, is pre-terminal, and is the lane's latest epoch
  // (a superseding get()/store() can invalidate a ticket mid-commit).
  private _commitStep(ticket: OperationTicket, step: () => void): void {
    if (this._lane.canCommit(ticket)) {
      step();
    }
  }

  // `supported` is probed at call time, so there is no stored value to set: this
  // dispatches the current one when it differs from the last one dispatched
  // (same-value guard). A state binding reads the property when it attaches; the
  // event is for every other listener.
  private _publishSupported(): void {
    const supported = this.supported;
    if (this._supportedPublished === supported) return;
    this._supportedPublished = supported;
    this._target.dispatchEvent(new CustomEvent("wcs-credential:supported-changed", {
      detail: supported,
      bubbles: true,
    }));
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

  // never-throw + unsupported: probe at call time what this call needs, and when
  // something is absent do NOT start — publish a stable `capability-missing`
  // taxonomy and return false. The container is needed by every call; the
  // `PasswordCredential` class only where the call is about password / federated
  // credentials (Firefox and Safari have the container for WebAuthn and no such
  // class: passed on to the browser, that would come back as a failure the page
  // could retry, `credential-failed`, when it is a browser that cannot do it).
  private _capabilitiesPresent(needsPasswordCredential: boolean): boolean {
    const availability = this.platformAssessment.availability;
    if (availability.get(CredentialCore.CONTAINER_CAPABILITY) !== "available") {
      const message = "Credential Management API is not supported in this browser.";
      this._setErrorInfo(WCS_CREDENTIAL_ERROR_CODE.CapabilityMissing, "start", false, message, CredentialCore.CONTAINER_CAPABILITY);
      this._setError({ message });
      return false;
    }
    if (needsPasswordCredential && availability.get(CredentialCore.PASSWORD_CAPABILITY) !== "available") {
      const message = "Password credentials are not supported in this browser.";
      this._setErrorInfo(WCS_CREDENTIAL_ERROR_CODE.CapabilityMissing, "start", false, message, CredentialCore.PASSWORD_CAPABILITY);
      this._setError({ name: "NotSupportedError", message });
      return false;
    }
    return true;
  }

  /**
   * `get(options)` — v1 scope excludes `publicKey` (WebAuthn). If present, it is
   * stripped and the call surfaces a scope-violation `error` instead of forwarding
   * it to the platform API. `navigator.credentials.get()` does not require a user
   * gesture, so this can be invoked automatically on page load for silent sign-in.
   * Options that ask for `password` or `federated` need the `PasswordCredential`
   * class; without it the call ends as `capability-missing` and the browser is not
   * asked. Anything that is not an object (`null`, `undefined`) asks for nothing.
   */
  async get(options?: (CredentialGetOptions & { publicKey?: unknown }) | null): Promise<Credential | null> {
    const request: CredentialGetOptions & { publicKey?: unknown } =
      options !== null && typeof options === "object" ? options : {};
    if ("publicKey" in request) {
      const message = "WebAuthn (publicKey) is out of scope for @wcstack/credential v1. Use a dedicated WebAuthn node instead.";
      this._setErrorInfo(WCS_CREDENTIAL_ERROR_CODE.OutOfScope, "start", false, message);
      this._setError({ name: "NotSupportedError", message });
      return null;
    }

    if (!this._capabilitiesPresent(Boolean(request.password) || request.federated != null)) {
      return null;
    }

    const nav = (globalThis as { navigator?: { credentials?: CredentialsContainer } }).navigator!;
    return this._run(() => nav.credentials!.get(request as CredentialRequestOptions));
  }

  /**
   * `store(credential)` — shares the same single lane as `get()`.
   * `navigator.credentials.store()` resolves `Promise<void>`, so `value` is
   * synthesized as an echo of the credential stored. A `PublicKeyCredential`
   * (`type === "public-key"`, WebAuthn) is rejected as a scope violation before
   * touching the platform API. A plain `{ id, password, name?, iconURL? }` is made
   * into a `PasswordCredential` first; a `Credential` instance is stored as it is.
   * Needs the `PasswordCredential` class (`capability-missing` without it).
   */
  async store(credential: StorableCredential | WcsPasswordCredentialData): Promise<Credential | null> {
    if ((credential as { type?: unknown } | null)?.type === "public-key") {
      const message = "WebAuthn (publicKey) credentials are out of scope for @wcstack/credential v1. Use a dedicated WebAuthn node instead.";
      this._setErrorInfo(WCS_CREDENTIAL_ERROR_CODE.OutOfScope, "start", false, message);
      this._setError({ name: "NotSupportedError", message });
      return null;
    }

    if (!this._capabilitiesPresent(true)) {
      return null;
    }

    const nav = (globalThis as { navigator?: { credentials?: CredentialsContainer } }).navigator!;
    return this._run(async () => {
      // Built inside the operation: a constructor that throws (an empty id) lands in
      // `error` like any other failure of this store().
      const stored = this._toCredential(credential);
      await nav.credentials!.store(stored);
      return stored;
    });
  }

  // A `Credential` instance passes through. Anything else with a string `id` and
  // `password` becomes a `PasswordCredential` with only the members given, so a
  // state method can store `{ id, password }` without reaching for a class that
  // only Chromium has. The rest is handed to the browser as it came (it rejects
  // what it cannot store). `Credential` is guarded: a browser may lack the class.
  private _toCredential(credential: StorableCredential | WcsPasswordCredentialData): Credential {
    const g = globalThis as {
      Credential?: unknown;
      PasswordCredential?: new (data: WcsPasswordCredentialData) => Credential;
    };
    if (typeof g.Credential === "function" && credential instanceof g.Credential) {
      return credential as Credential;
    }
    const data = credential as Partial<WcsPasswordCredentialData> | null | undefined;
    if (typeof data?.id !== "string" || typeof data.password !== "string") {
      return credential as Credential;
    }
    const init: WcsPasswordCredentialData = { id: data.id, password: data.password };
    if (data.name != null) init.name = data.name;
    if (data.iconURL != null) init.iconURL = data.iconURL;
    // Probed by _capabilitiesPresent(true) just before the operation started.
    return new g.PasswordCredential!(init);
  }

  /**
   * `preventSilentAccess()` — sign-out. Asks the browser not to hand this origin's
   * credential over without the user (`navigator.credentials.preventSilentAccess()`):
   * otherwise the next visit's `get({ mediation: "silent" })` signs the user straight
   * back in. Never-throw: success clears `error`, a rejection lands in `error` /
   * `errorInfo` (`credential-failed`). Where `navigator.credentials` or the method is
   * missing it resolves having done nothing — signing out must work everywhere, and
   * there is nothing to switch off. It does not touch `value` or `loading`.
   *
   * Not on the lane: it has no result to race, so a get()/store() in flight neither
   * supersedes it nor is superseded by it. Only a dispose() drops its completion.
   */
  async preventSilentAccess(): Promise<void> {
    const credentials = (globalThis as { navigator?: { credentials?: { preventSilentAccess?: unknown } } }).navigator?.credentials;
    if (credentials == null || typeof credentials.preventSilentAccess !== "function") {
      return;
    }
    const generation = this._lane.ownerGeneration;
    try {
      await (credentials as CredentialsContainer).preventSilentAccess();
      if (generation !== this._lane.ownerGeneration) return;
      this._commitErrorInfo(null);
      this._setError(null);
    } catch (e) {
      if (generation !== this._lane.ownerGeneration) return;
      const norm = this._normalizeError(e);
      this._setErrorInfo(WCS_CREDENTIAL_ERROR_CODE.CredentialFailed, "execute", true, norm.message);
      this._setError(norm);
    }
  }
}

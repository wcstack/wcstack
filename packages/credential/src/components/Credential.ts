import { CredentialGetOptions, IWcBindable, StorableCredential } from "../types.js";
import { CredentialCore } from "../core/CredentialCore.js";

/**
 * `<wcs-credential>` — declarative Credential Management API primitive
 * (password/federated only — see docs/credential-tag-design.md §0 for the
 * WebAuthn scope exclusion).
 *
 * A thin command-only Shell (mirrors `<wcs-share>`): no attributes at all.
 * `get(options)`/`store(credential)`'s arguments are per-call.
 */
export class WcsCredential extends HTMLElement {
  static hasConnectedCallbackPromise = true;

  static wcBindable: IWcBindable = {
    ...CredentialCore.wcBindable,
    inputs: [],
    // Inherit commands from Core (single source of truth).
    commands: CredentialCore.wcBindable.commands,
  };

  private _core: CredentialCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._core = new CredentialCore(this);
  }

  // --- Core delegated getters ---

  get value(): Credential | null {
    return this._core.value;
  }

  get loading(): boolean {
    return this._core.loading;
  }

  get error(): any {
    return this._core.error;
  }

  get cancelled(): boolean {
    return this._core.cancelled;
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Commands ---

  get(options?: CredentialGetOptions): Promise<Credential | null> {
    return this._core.get(options);
  }

  store(credential: StorableCredential): Promise<Credential | null> {
    return this._core.store(credential);
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.style.display = "none";
    this._connectedCallbackPromise = this._core.observe();
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }
}

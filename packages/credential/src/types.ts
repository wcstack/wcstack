import type { WcsIoErrorInfo } from "./core/platformCapability.js";

export interface ITagNames {
  readonly credential: string;
}

export interface IWritableTagNames {
  credential?: string;
}

export interface IConfig {
  readonly tagNames: ITagNames;
}

export interface IWritableConfig {
  tagNames?: IWritableTagNames;
}

// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

/**
 * v1 scope: password/federated credentials only (docs/credential-tag-design.md
 * §0). `publicKey` (WebAuthn) is a much larger surface — attestation,
 * authenticator selection, platform vs cross-platform, RP configuration —
 * that deserves its own dedicated node in a future batch. This Core validates
 * and strips a `publicKey` key if a caller passes one, rather than silently
 * forwarding it (which would accidentally support WebAuthn through a side
 * door this package explicitly does not claim to support).
 */
export interface CredentialGetOptions {
  password?: boolean;
  federated?: { providers?: string[]; protocols?: string[] };
  mediation?: "silent" | "optional" | "required";
  signal?: AbortSignal;
}

/** A password or federated credential, as accepted by `navigator.credentials.store()`. */
export type StorableCredential = Credential;

/**
 * A password credential as plain data, for `store()`: when the argument is not a
 * `Credential` instance and has a string `id` and `password`, the element builds
 * `new PasswordCredential(...)` from it (only the members given) and stores that.
 * Lets a state method pass `{ id, password }` without touching a browser class
 * that exists in Chromium only.
 */
export interface WcsPasswordCredentialData {
  id: string;
  password: string;
  name?: string;
  iconURL?: string;
}

/**
 * Value types for CredentialCore (headless) — the observable state properties.
 */
export interface WcsCredentialCoreValues {
  // The credential of the last successful get()/store(). A password credential
  // carries the password: bind `value` into state only where that is intended.
  value: Credential | null;
  loading: boolean;
  // A true platform failure (anything other than the user cancelling the
  // account chooser, or a v1 scope violation such as a `publicKey` option).
  error: any;
  // `true` when the user dismissed the browser's account-chooser UI. The
  // Credential Management API rejects with `NotAllowedError` (not `AbortError`)
  // on user refusal — see docs/credential-tag-design.md §2. Kept separate from
  // `error`, mirroring `@wcstack/share`'s `cancelled` (which keys off that
  // API's own dismissal error name instead).
  cancelled: boolean;
  // Last failure's serializable taxonomy (stable code/phase/recoverable), or null.
  errorInfo: WcsIoErrorInfo | null;
  // `true` when this page can use password credentials: `navigator.credentials`
  // is there and so is the `PasswordCredential` class (Chromium only). It does not
  // say a credential is saved, or that the user will choose one.
  supported: boolean;
}

/**
 * Value types for the Shell (`<wcs-credential>`) — identical observable
 * surface to the Core.
 */
export type WcsCredentialValues = WcsCredentialCoreValues;

import { vi } from "vitest";

/**
 * Fakes of the `Credential` / `PasswordCredential` classes (happy-dom has neither).
 * `PasswordCredential` exists in Chromium only; the Core builds one from a plain
 * `{ id, password }` and refuses password work where the class is missing, so the
 * install helpers below put both classes in place — a Chromium-like page — and
 * `removePasswordCredential()` turns it into a Firefox / Safari-like one.
 */
export class FakeCredential {
  readonly id: string;
  readonly type: string;
  constructor(id: string, type: string) {
    this.id = id;
    this.type = type;
  }
}

export class FakePasswordCredential extends FakeCredential {
  /** Every init object a `new PasswordCredential(init)` received, in call order. */
  static inits: any[] = [];
  readonly password: string;
  readonly name: string;
  readonly iconURL: string;
  constructor(init: { id: string; password: string; name?: string; iconURL?: string }) {
    FakePasswordCredential.inits.push(init);
    // The real constructor throws a TypeError for an empty id or password.
    if (init.id === "" || init.password === "") {
      throw new TypeError("Failed to construct 'PasswordCredential': 'id' and 'password' must not be empty.");
    }
    super(init.id, "password");
    this.password = init.password;
    this.name = init.name ?? "";
    this.iconURL = init.iconURL ?? "";
  }
}

/** Install the `Credential` and `PasswordCredential` classes (a Chromium-like page). */
export function installCredentialClasses(): void {
  FakePasswordCredential.inits = [];
  (globalThis as any).Credential = FakeCredential;
  (globalThis as any).PasswordCredential = FakePasswordCredential;
}

/** Remove `PasswordCredential` only: Firefox / Safari have `navigator.credentials` (WebAuthn) without it. */
export function removePasswordCredential(): void {
  delete (globalThis as any).PasswordCredential;
}

/** Remove the `Credential` base class only (the Core guards `instanceof Credential`). */
export function removeCredentialClass(): void {
  delete (globalThis as any).Credential;
}

/** Install navigator.credentials.get as a controllable fake. Returns the mock fn for inspection. */
export function installGet(impl: (options?: any) => Promise<any>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  const existing = (navigator as any).credentials ?? {};
  Object.defineProperty(navigator, "credentials", {
    value: { ...existing, get: fn },
    configurable: true,
    writable: true,
  });
  installCredentialClasses();
  return fn;
}

/** Install navigator.credentials.store as a controllable fake. Returns the mock fn for inspection. */
export function installStore(impl: (credential?: any) => Promise<any>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  const existing = (navigator as any).credentials ?? {};
  Object.defineProperty(navigator, "credentials", {
    value: { ...existing, store: fn },
    configurable: true,
    writable: true,
  });
  installCredentialClasses();
  return fn;
}

/** Install navigator.credentials.preventSilentAccess as a controllable fake. Returns the mock fn for inspection. */
export function installPreventSilentAccess(impl: () => Promise<void>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  const existing = (navigator as any).credentials ?? {};
  Object.defineProperty(navigator, "credentials", {
    value: { ...existing, preventSilentAccess: fn },
    configurable: true,
    writable: true,
  });
  return fn;
}

/** Remove navigator.credentials (and the credential classes) so the "unsupported" branch can be tested. */
export function removeCredentials(): void {
  Object.defineProperty(navigator, "credentials", {
    value: undefined,
    configurable: true,
    writable: true,
  });
  removePasswordCredential();
  removeCredentialClass();
}

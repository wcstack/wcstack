import { vi } from "vitest";

/** Install navigator.credentials.get as a controllable fake. Returns the mock fn for inspection. */
export function installGet(impl: (options?: any) => Promise<any>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  const existing = (navigator as any).credentials ?? {};
  Object.defineProperty(navigator, "credentials", {
    value: { ...existing, get: fn },
    configurable: true,
    writable: true,
  });
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
  return fn;
}

/** Remove navigator.credentials so the "unsupported" branch can be tested. */
export function removeCredentials(): void {
  Object.defineProperty(navigator, "credentials", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

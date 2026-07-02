import { vi } from "vitest";

/** Install navigator.contacts.select as a controllable fake. Returns the mock fn for inspection. */
export function installSelect(impl: (properties: string[], options?: { multiple?: boolean }) => Promise<any[]>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  Object.defineProperty(navigator, "contacts", {
    value: { select: fn },
    configurable: true,
    writable: true,
  });
  return fn;
}

/** Remove navigator.contacts so the "unsupported" branch can be tested (the Android-Chrome-only default). */
export function removeContacts(): void {
  Object.defineProperty(navigator, "contacts", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

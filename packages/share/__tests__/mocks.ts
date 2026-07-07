import { vi } from "vitest";

/** Install navigator.share as a controllable fake. Returns the mock fn for inspection. */
export function installShare(impl: (data?: any) => Promise<void>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  Object.defineProperty(navigator, "share", {
    value: fn,
    configurable: true,
    writable: true,
  });
  return fn;
}

/** Remove navigator.share so the "unsupported" branch can be tested. */
export function removeShare(): void {
  Object.defineProperty(navigator, "share", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

/** Install navigator.canShare as a controllable fake. Returns the mock fn for inspection. */
export function installCanShare(impl: (data?: any) => boolean): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  Object.defineProperty(navigator, "canShare", {
    value: fn,
    configurable: true,
    writable: true,
  });
  return fn;
}

/** Remove navigator.canShare so the "absent" branch can be tested. */
export function removeCanShare(): void {
  Object.defineProperty(navigator, "canShare", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

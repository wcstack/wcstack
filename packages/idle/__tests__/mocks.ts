import { vi } from "vitest";

export class FakeIdleDetector extends EventTarget {
  userState: "active" | "idle" = "active";
  screenState: "locked" | "unlocked" = "unlocked";
  start = vi.fn((_options: { threshold: number; signal: AbortSignal }) => Promise.resolve());

  /** Test helper: update state and fire `change`, mirroring the real API. */
  emitChange(userState: "active" | "idle", screenState: "locked" | "unlocked"): void {
    this.userState = userState;
    this.screenState = screenState;
    this.dispatchEvent(new Event("change"));
  }
}

/**
 * Install `globalThis.IdleDetector` as a fake class. `requestPermission` is a
 * static method on the class itself (matching the real platform shape), so
 * this must replace the whole global — a plain object swap is not enough.
 */
export function installIdleDetector(opts: {
  requestPermission?: () => Promise<"granted" | "denied">;
  startImpl?: (this: FakeIdleDetector, options: { threshold: number; signal: AbortSignal }) => Promise<void>;
} = {}): { requestPermission: ReturnType<typeof vi.fn>; instances: FakeIdleDetector[] } {
  const instances: FakeIdleDetector[] = [];
  const requestPermission = vi.fn(opts.requestPermission ?? (() => Promise.resolve("granted" as const)));

  class InstalledFakeIdleDetector extends FakeIdleDetector {
    static requestPermission = requestPermission;
    constructor() {
      super();
      if (opts.startImpl) {
        this.start = vi.fn(opts.startImpl.bind(this));
      }
      instances.push(this);
    }
  }

  (globalThis as any).IdleDetector = InstalledFakeIdleDetector;
  return { requestPermission, instances };
}

/** Remove globalThis.IdleDetector so the "unsupported" branch can be tested (the Chromium-only default elsewhere). */
export function removeIdleDetector(): void {
  delete (globalThis as any).IdleDetector;
}

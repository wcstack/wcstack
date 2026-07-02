export interface PendingOpen {
  /** Resolve the in-flight open() call with a successful result. */
  resolve: (result: { sRGBHex: string }) => void;
  /** Reject the in-flight open() call (e.g. with an AbortError or a real failure). */
  reject: (error: any) => void;
  /** The `{signal}` options object the fake's open() was called with. */
  signal: AbortSignal | undefined;
}

/**
 * A controllable fake of the global `EyeDropper` constructor. Unlike
 * `navigator.share` (a plain function), `EyeDropper` is a class the platform
 * exposes globally (`new EyeDropper().open(options)`), so the fake must
 * install/remove a whole constructor rather than a single function
 * (docs/eyedropper-tag-design.md — Fake double section of the implementation
 * plan).
 *
 * Each `new FakeEyeDropper()` + `.open(options)` call is tracked in
 * `pendingOpens` so a test can resolve/reject it directly, and — because
 * `open()` accepts a `{signal}` AbortSignal — the fake subscribes to that
 * signal's `abort` event and rejects with a real `AbortError` `DOMException`,
 * exactly like the platform does when a caller invokes `abort()` on the
 * AbortController mid-pick.
 */
export function installEyeDropper(): { pendingOpens: PendingOpen[] } {
  const pendingOpens: PendingOpen[] = [];

  class FakeEyeDropper {
    open(options?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }> {
      return new Promise((resolve, reject) => {
        const entry: PendingOpen = { resolve, reject, signal: options?.signal };
        pendingOpens.push(entry);

        if (options?.signal) {
          if (options.signal.aborted) {
            reject(new DOMException("The user aborted a request.", "AbortError"));
            return;
          }
          options.signal.addEventListener("abort", () => {
            reject(new DOMException("The user aborted a request.", "AbortError"));
          });
        }
      });
    }
  }

  (globalThis as any).EyeDropper = FakeEyeDropper;
  return { pendingOpens };
}

/** Remove the global EyeDropper constructor so the "unsupported" branch can be tested. */
export function removeEyeDropper(): void {
  delete (globalThis as any).EyeDropper;
}

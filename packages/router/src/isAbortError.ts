/**
 * A navigation another one took over — a guard's redirect, a newer navigation — rejects with an
 * `AbortError` (Navigation API). That is the designed outcome, not a failure: the write surfaces
 * (`navigateUrl` / `replaceUrl`) and the guard's fallback do not report it (docs/seam-apps.md,
 * router-auth — `navigateUrl` to a guarded page logged "navigate failed: AbortError").
 */
export function isAbortError(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === "AbortError";
}

// Internal error-reporting policy (NOT part of the public API; not re-exported
// from exports.ts). Single source of truth for "surface an error without crashing".
//
// Delegates to the platform `reportError` when present — it dispatches a window
// "error" event / logs to the console without aborting the current task — and falls
// back to `console.error` otherwise. It NEVER re-throws (re-throwing would abort the
// caller's drain / abort handler) and NEVER swallows silently (that would hide bugs).
export function reportError(err: unknown): void {
  const r = (globalThis as { reportError?: (e: unknown) => void }).reportError;
  if (typeof r === "function") {
    r(err);
  } else {
    console.error(err);
  }
}

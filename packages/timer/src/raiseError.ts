// Intentionally retained for cross-package consistency: every @wcstack package
// ships this helper as standard scaffolding (see fetch/router/state/..., which
// do throw on invalid input). TimerCore follows a never-throw design — invalid
// input (e.g. a non-positive interval) is silently folded to a safe default
// rather than raised — so it has no synchronous throw path today and does not
// import this. Keeping the helper means a future synchronous precondition can
// raise a consistently-prefixed error without re-introducing boilerplate. It is
// not part of the public exports, so it adds no API surface.
export function raiseError(message: string): never {
  throw new Error(`[@wcstack/timer] ${message}`);
}

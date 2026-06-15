// Intentionally retained for cross-package consistency: every @wcstack package
// ships this helper as standard scaffolding (see fetch/router/state/..., which
// do throw on invalid input). DefinedCore follows a never-throw design and
// surfaces all failures through the `error` / `missing` state rather than
// throwing, so it has no synchronous throw path today and does not import this.
// Keeping the helper means a future synchronous precondition can raise a
// consistently-prefixed error without re-introducing boilerplate. It is not part
// of the public exports, so it adds no API surface.
//
// Coverage note: this file is NOT in vitest.config's coverage `exclude`, yet the
// 100% thresholds still pass. That is because v8 only instruments modules actually
// loaded during the run, and nothing imports raiseError, so it never enters the
// coverage graph (it is not counted in the statement/line denominator). The day a
// source module imports it, it becomes measured and must be exercised by a test —
// which is the intended trigger to add that test.
export function raiseError(message: string): never {
  throw new Error(`[@wcstack/defined] ${message}`);
}

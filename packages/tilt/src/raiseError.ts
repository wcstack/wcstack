// Intentionally retained for cross-package consistency: every @wcstack package
// ships this helper as standard scaffolding. TiltCore follows a never-throw
// design and has no synchronous throw path today, so it does not import this.
// Keeping the helper means a future synchronous precondition can raise a
// consistently-prefixed error without re-introducing boilerplate. It is not
// part of the public exports, so it adds no API surface.
export function raiseError(message: string): never {
  throw new Error(`[@wcstack/tilt] ${message}`);
}

// Intentionally retained for cross-package consistency: every @wcstack package
// ships this helper as standard scaffolding (see fetch/router/state/..., which
// do throw on invalid input). ResizeCore follows a never-throw design and surfaces
// nothing on invalid options (silent no-op, like the geolocation `error` property
// approach), so it has no synchronous throw path today and does not import this.
// Keeping the helper means a future synchronous precondition can raise a
// consistently-prefixed error without re-introducing boilerplate. It is not part
// of the public exports, so it adds no API surface.
export function raiseError(message: string): never {
  throw new Error(`[@wcstack/resize] ${message}`);
}

// Intentionally retained for cross-package consistency: every @wcstack package
// ships this helper as standard scaffolding (see fetch/router/state/..., which
// do throw on invalid input). AudioGraphCore follows a never-throw design and
// surfaces failures through `state` / `error` / `warnings` rather than throwing
// — a single bad wire must not silence a patch that is otherwise playable — so
// it has no synchronous throw path today and does not import this. It is not
// part of the public exports, so it adds no API surface.
export function raiseError(message: string): never {
  throw new Error(`[@wcstack/audio] ${message}`);
}

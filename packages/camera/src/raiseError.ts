// Intentionally retained for cross-package consistency: every @wcstack package
// ships this helper as standard scaffolding. CameraCore / RecorderCore follow a
// never-throw design and surface all failures through the `error` property rather
// than throwing, so they have no synchronous throw path today. Keeping the helper
// means a future synchronous precondition can raise a consistently-prefixed error
// without re-introducing boilerplate. It is not part of the public exports.
export function raiseError(message: string): never {
  throw new Error(`[@wcstack/camera] ${message}`);
}

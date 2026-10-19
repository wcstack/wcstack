/**
 * Which streams a recorder is recording right now. A recorder borrows its stream and a
 * camera owns it, and neither holds the other; but a camera that stops its stream while
 * it is hidden ends a recording of it, so it asks here first
 * (`[wcs/camera-keep-alive-missing]`). Counted, since two recorders may record one stream.
 */
const recording = new WeakMap<MediaStream, number>();

export function beginRecording(stream: MediaStream): void {
  recording.set(stream, (recording.get(stream) ?? 0) + 1);
}

export function endRecording(stream: MediaStream): void {
  const n = (recording.get(stream) ?? 0) - 1;
  if (n > 0) recording.set(stream, n);
  else recording.delete(stream);
}

export function isRecording(stream: MediaStream): boolean {
  return recording.has(stream);
}

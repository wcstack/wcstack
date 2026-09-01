/**
 * Dispatch a DOM event the way a user action would: bubbling by default, a
 * `CustomEvent` when `detail` is given, a plain `Event` otherwise.
 *
 * Returns what `dispatchEvent` returns (`false` when a handler called
 * `preventDefault()`). Follow with `await settle()` before asserting the DOM.
 */
export function fire(target: EventTarget, type: string, init: EventInit & { detail?: unknown } = {}): boolean {
  const { detail, ...eventInit } = init;
  const event = detail !== undefined
    ? new CustomEvent(type, { bubbles: true, ...eventInit, detail })
    : new Event(type, { bubbles: true, ...eventInit });
  return target.dispatchEvent(event);
}

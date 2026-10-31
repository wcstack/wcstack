import { checkOptions, isAny, isBoolean, type OptionSpec } from "./options.js";

const FIRE_INIT: OptionSpec = {
  bubbles: [isBoolean, "a boolean"],
  cancelable: [isBoolean, "a boolean"],
  composed: [isBoolean, "a boolean"],
  detail: [isAny, "any value"],
};

/**
 * Dispatch a DOM event the way a user action would: bubbling by default, a
 * `CustomEvent` when `detail` is given, a plain `Event` otherwise.
 *
 * Returns what `dispatchEvent` returns (`false` when a handler called
 * `preventDefault()`). Follow with `await settle()` before asserting the DOM.
 * An `init` key other than `bubbles` / `cancelable` / `composed` / `detail` throws:
 * it would not reach the event (`{ key: "Enter" }` makes no `KeyboardEvent`).
 */
export function fire(target: EventTarget, type: string, init: EventInit & { detail?: unknown } = {}): boolean {
  checkOptions(
    "fire()",
    init,
    FIRE_INIT,
    " fire() dispatches an Event, or a CustomEvent with detail; for another event class (KeyboardEvent, InputEvent, …) call target.dispatchEvent() yourself.",
  );
  const { detail, ...eventInit } = init;
  const event = detail !== undefined
    ? new CustomEvent(type, { bubbles: true, ...eventInit, detail })
    : new Event(type, { bubbles: true, ...eventInit });
  return target.dispatchEvent(event);
}

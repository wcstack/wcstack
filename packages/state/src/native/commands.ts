/**
 * Native element commands (the native-commands add-on): `command.<method>:` on an element with no
 * wc-bindable declaration — `<dialog data-wcs="command.showModal: $command.open">` — so a state
 * opens a dialog, focuses an input or plays a video by emitting a token, never by reaching the
 * element (docs/state-engine-rewrite/native-commands.ja.md).
 */
import type { NativeCall } from "../hooks";
import { raise, M } from "../messages";

/**
 * The methods a native element's `command.<method>:` may call, by tag (`*`: every element). None
 * writes HTML, an attribute or the tree, or changes a control's value without its `input` event
 * (the state would not see it). Decided by this table alone, not by what the element has: a
 * binding binds in every browser (and on the server) alike, and a method a browser lacks fails
 * when it is called. The tooling manifest publishes a copy as `nativeCommands`.
 */
export const NATIVE_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  "*": ["focus", "blur", "click", "scrollIntoView", "showPopover", "hidePopover", "togglePopover"],
  "dialog": ["show", "showModal", "close", "requestClose"],
  "form": ["requestSubmit", "checkValidity", "reportValidity"],
  "input": ["select", "setSelectionRange", "showPicker", "setCustomValidity", "checkValidity", "reportValidity"],
  "textarea": ["select", "setSelectionRange", "setCustomValidity", "checkValidity", "reportValidity"],
  "select": ["showPicker", "setCustomValidity", "checkValidity", "reportValidity"],
  "audio": ["play", "pause", "load"],
  "video": ["play", "pause", "load"],
};

/** What a native `tag` may be commanded to run (its own row only: `<constructor>` reads no prototype). */
export const nativeCommandsOf = (tag: string): readonly string[] =>
  [...NATIVE_COMMANDS["*"], ...(Object.hasOwn(NATIVE_COMMANDS, tag) ? NATIVE_COMMANDS[tag] : [])];

/** `hooks.nativeCommand`: null for a custom element (it declares its commands); throws for a method outside the table. */
export function nativeCommand(el: Element, method: string): NativeCall | null {
  const tag = el.localName;
  if (tag.includes("-")) return null;
  const allowed = nativeCommandsOf(tag);
  if (!allowed.includes(method)) raise(M.NativeNoCommand, [tag, method, allowed.join(", ")], method, allowed);
  // an event's emit (`onclick: $command.x`: the event, then the list indexes) is no argument of a
  // native method — `close(event)` would set the dialog's returnValue to "[object PointerEvent]"
  return (target, args) => (target as any)[method](...(args[0] instanceof Event ? [] : args));
}

import { config } from "./config.js";
import type { WcsBroadcast } from "./components/Broadcast.js";

let registered = false;

// Attribute names for the optional post-on-click DOM trigger (clipboard.js-style
// DX). The element carrying `data-broadcast-target` points at a <wcs-broadcast>
// by id; the text to post comes from either a literal `data-broadcast-text` or
// a `data-broadcast-from` CSS selector resolving to a source element.
const TEXT_ATTRIBUTE = "data-broadcast-text";
const FROM_ATTRIBUTE = "data-broadcast-from";

function resolveText(triggerElement: Element): string | null {
  // Literal text wins when present (including an empty string — posting "" is a
  // legitimate request). The `?? ""` right-hand side is defensive and
  // unreachable: hasAttribute() just returned true, so getAttribute() cannot be
  // null here. It exists only to satisfy the `string | null` return type — do
  // not chase coverage on it (the DOM contract makes the null branch impossible).
  if (triggerElement.hasAttribute(TEXT_ATTRIBUTE)) {
    return triggerElement.getAttribute(TEXT_ATTRIBUTE) ?? "";
  }
  const selector = triggerElement.getAttribute(FROM_ATTRIBUTE);
  if (!selector) return null;
  // A user-authored selector can be syntactically invalid (e.g. `[data-*` or a
  // bare `:not()`), which makes querySelector throw a SyntaxError. Swallow it
  // and treat the source as unresolvable — the same "nothing to post" path as a
  // selector that matches no element — so one bad attribute never crashes the
  // document-level click handler and kills autoTrigger for the whole tab.
  let source: Element | null;
  try {
    source = document.querySelector(selector);
  } catch {
    return null;
  }
  if (!source) return null;
  // Read a form control's `value`; fall back to text content. A bare
  // `"value" in source` check is too broad — it also matches <button>,
  // <li value>, <progress>, etc. (which carry an unrelated `value`), posting the
  // wrong thing. Narrow to the text-bearing controls a user actually points
  // `data-broadcast-from` at; everything else falls through to textContent.
  if (
    source instanceof HTMLInputElement ||
    source instanceof HTMLTextAreaElement ||
    source instanceof HTMLSelectElement
  ) {
    return source.value;
  }
  // `?? ""` is defensive: per the DOM spec only Document / DocumentType /
  // Notation nodes have a null `textContent`, and querySelector only ever
  // returns an Element (whose textContent is always a string). The branch is
  // therefore unreachable in practice and kept solely for the `string | null`
  // type — not worth a contrived test.
  return source.textContent ?? "";
}

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const broadcastId = triggerElement.getAttribute(config.triggerAttribute);
  if (!broadcastId) return;

  // Resolve the registered constructor at call time instead of importing
  // WcsBroadcast as a value (avoids a components ⇄ autoTrigger import cycle:
  // Broadcast.connectedCallback() calls registerAutoTrigger()). instanceof
  // against the customElements registry keeps the same identity guarantee.
  const BroadcastCtor = customElements.get(config.tagNames.broadcast);
  const broadcastElement = document.getElementById(broadcastId);
  if (!BroadcastCtor || !(broadcastElement instanceof BroadcastCtor)) return;

  const text = resolveText(triggerElement);
  // No resolvable source: leave the click alone (do not preventDefault) so the
  // element's default action is unaffected.
  if (text === null) return;

  // Suppress the default action so a post can run without navigating. Intentional:
  // do not attach data-broadcast-target to an element whose default action you
  // also want (a real <a href> link). See README "Optional DOM Triggering".
  event.preventDefault();
  (broadcastElement as WcsBroadcast).post(text);
}

export function registerAutoTrigger(): void {
  if (registered) return;
  registered = true;
  document.addEventListener("click", handleClick);
}

export function unregisterAutoTrigger(): void {
  if (!registered) return;
  registered = false;
  document.removeEventListener("click", handleClick);
}

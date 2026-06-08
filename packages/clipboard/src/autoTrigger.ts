import { config } from "./config.js";
import type { WcsClipboard } from "./components/Clipboard.js";

let registered = false;

// Attribute names for the optional copy-on-click DOM trigger (clipboard.js-style
// DX). The element carrying `data-clipboardtarget` points at a <wcs-clipboard>
// by id; the text to copy comes from either a literal `data-clipboard-text` or
// a `data-clipboard-from` CSS selector resolving to a source element.
const TEXT_ATTRIBUTE = "data-clipboard-text";
const FROM_ATTRIBUTE = "data-clipboard-from";

function resolveText(triggerElement: Element): string | null {
  // Literal text wins when present (including an empty string — copying "" is a
  // legitimate request).
  if (triggerElement.hasAttribute(TEXT_ATTRIBUTE)) {
    return triggerElement.getAttribute(TEXT_ATTRIBUTE) ?? "";
  }
  const selector = triggerElement.getAttribute(FROM_ATTRIBUTE);
  if (!selector) return null;
  const source = document.querySelector(selector);
  if (!source) return null;
  // Read a form control's `value`; fall back to text content. A bare
  // `"value" in source` check is too broad — it also matches <button>,
  // <li value>, <progress>, etc. (which carry an unrelated `value`), copying
  // the wrong thing. Narrow to the text-bearing controls a user actually points
  // `data-clipboard-from` at; everything else falls through to textContent.
  if (
    source instanceof HTMLInputElement ||
    source instanceof HTMLTextAreaElement ||
    source instanceof HTMLSelectElement
  ) {
    return source.value;
  }
  return source.textContent ?? "";
}

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const clipboardId = triggerElement.getAttribute(config.triggerAttribute);
  if (!clipboardId) return;

  // Resolve the registered constructor at call time instead of importing
  // WcsClipboard as a value (avoids a components ⇄ autoTrigger import cycle:
  // Clipboard.connectedCallback() calls registerAutoTrigger()). instanceof
  // against the customElements registry keeps the same identity guarantee.
  const ClipboardCtor = customElements.get(config.tagNames.clipboard);
  const clipboardElement = document.getElementById(clipboardId);
  if (!ClipboardCtor || !(clipboardElement instanceof ClipboardCtor)) return;

  const text = resolveText(triggerElement);
  // No resolvable source: leave the click alone (do not preventDefault) so the
  // element's default action is unaffected.
  if (text === null) return;

  // Suppress the default action so a copy can run without navigating. Intentional:
  // do not attach data-clipboardtarget to an element whose default action you
  // also want (real <a href> link). See README "Optional DOM Triggering".
  event.preventDefault();
  (clipboardElement as WcsClipboard).writeText(text);
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

import { config } from "./config.js";
import type { WcsNotify } from "./components/Notify.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  // A misconfigured triggerAttribute (e.g. one with a space) makes the attribute
  // selector invalid and closest() throw SyntaxError; guard so a bad config
  // disables only this shortcut rather than killing every document click handler.
  let triggerElement: Element | null;
  try {
    triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  } catch {
    return;
  }
  if (!triggerElement) return;

  const notifyId = triggerElement.getAttribute(config.triggerAttribute);
  if (!notifyId) return;

  // Resolve the registered constructor at call time instead of importing Notify as
  // a value, avoiding a components/Notify.ts ⇄ autoTrigger.ts cycle
  // (Notify.connectedCallback() calls registerAutoTrigger()). instanceof against
  // the customElements registry keeps the same identity guarantee.
  const NotifyCtor = customElements.get(config.tagNames.notify);
  const notifyElement = document.getElementById(notifyId);
  if (!NotifyCtor || !(notifyElement instanceof NotifyCtor)) return;

  // The title comes from the trigger element: an explicit `data-notifytitle`
  // attribute wins, otherwise the element's trimmed text content. The body is an
  // optional `data-notifybody`. This keeps the click-driven shortcut declarative
  // without inventing a payload channel.
  const explicit = triggerElement.getAttribute("data-notifytitle");
  // `Element.textContent` is spec-guaranteed non-null (only Document / DocumentType
  // nodes return null, never an Element), so the cast is sound and lets us avoid an
  // unreachable `?? ""` branch. `triggerElement` is always an Element here.
  const title = explicit !== null ? explicit : (triggerElement.textContent as string).trim();
  const body = triggerElement.getAttribute("data-notifybody");

  (notifyElement as WcsNotify).notify(title, body !== null ? { body } : undefined);
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

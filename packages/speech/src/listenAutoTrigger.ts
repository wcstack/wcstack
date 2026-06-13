import { config } from "./config.js";
import type { WcsListen } from "./components/Listen.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  // A misconfigured listenTriggerAttribute (e.g. one with a space) makes the
  // attribute selector invalid and closest() throw SyntaxError; guard so a bad
  // config disables only this shortcut rather than killing every click handler.
  let triggerElement: Element | null;
  try {
    triggerElement = target.closest<Element>(`[${config.listenTriggerAttribute}]`);
  } catch {
    return;
  }
  if (!triggerElement) return;

  const listenId = triggerElement.getAttribute(config.listenTriggerAttribute);
  if (!listenId) return;

  const ListenCtor = customElements.get(config.tagNames.listen);
  const listenElement = document.getElementById(listenId);
  if (!ListenCtor || !(listenElement instanceof ListenCtor)) return;

  event.preventDefault();
  // Toggle: clicking starts a session, clicking again while listening stops it.
  const el = listenElement as WcsListen;
  if (el.listening) {
    el.stop();
  } else {
    el.start();
  }
}

export function registerListenAutoTrigger(): void {
  if (registered) return;
  registered = true;
  document.addEventListener("click", handleClick);
}

export function unregisterListenAutoTrigger(): void {
  if (!registered) return;
  registered = false;
  document.removeEventListener("click", handleClick);
}

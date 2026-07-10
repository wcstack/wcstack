import { config } from "./config.js";
import type { Raf } from "./components/Raf.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const rafId = triggerElement.getAttribute(config.triggerAttribute);
  if (!rafId) return;

  // Resolve the registered constructor at call time instead of importing Raf
  // as a value. The value import created a components/Raf.ts ⇄ autoTrigger.ts
  // cycle (Raf.connectedCallback() calls registerAutoTrigger()). instanceof
  // against the customElements registry keeps the exact same identity guarantee
  // — only the registered <wcs-raf> class matches — without the import cycle.
  const RafCtor = customElements.get(config.tagNames.raf);
  const rafElement = document.getElementById(rafId);
  if (!RafCtor || !(rafElement instanceof RafCtor)) return;

  // Suppress the element's default action so a loop can start without
  // navigating. Intentional: do not attach data-raftarget to an element whose
  // default action you also want (real <a href> link, form-submit button) — it
  // will be cancelled. See README "Optional DOM Triggering".
  event.preventDefault();
  (rafElement as Raf).start();
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

import { config } from "./config.js";
import type { Timer } from "./components/Timer.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const timerId = triggerElement.getAttribute(config.triggerAttribute);
  if (!timerId) return;

  // Resolve the registered constructor at call time instead of importing Timer
  // as a value. The value import created a components/Timer.ts ⇄ autoTrigger.ts
  // cycle (Timer.connectedCallback() calls registerAutoTrigger()). instanceof
  // against the customElements registry keeps the exact same identity guarantee
  // — only the registered <wcs-timer> class matches — without the import cycle.
  const TimerCtor = customElements.get(config.tagNames.timer);
  const timerElement = document.getElementById(timerId);
  if (!TimerCtor || !(timerElement instanceof TimerCtor)) return;

  // Suppress the element's default action so a timer can start without
  // navigating. Intentional: do not attach data-timertarget to an element whose
  // default action you also want (real <a href> link, form-submit button) — it
  // will be cancelled. See README "Optional DOM Triggering".
  event.preventDefault();
  (timerElement as Timer).start();
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

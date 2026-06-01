import { config } from "./config.js";
import { Timer } from "./components/Timer.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const timerId = triggerElement.getAttribute(config.triggerAttribute);
  if (!timerId) return;

  const timerElement = document.getElementById(timerId) as Timer | null;
  if (!timerElement || !(timerElement instanceof Timer)) return;

  // Suppress the element's default action so a timer can start without
  // navigating. Intentional: do not attach data-timertarget to an element whose
  // default action you also want (real <a href> link, form-submit button) — it
  // will be cancelled. See README "Optional DOM Triggering".
  event.preventDefault();
  timerElement.start();
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

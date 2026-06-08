import { config } from "./config.js";

let registered = false;

interface Triggerable extends Element {
  trigger(...args: unknown[]): void;
}

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const id = triggerElement.getAttribute(config.triggerAttribute);
  if (!id) return;

  // Resolve the registered constructors at call time (avoids a components ⇄
  // autoTrigger import cycle, mirroring <wcs-timer>). The DOM trigger fires a
  // single coalesced pulse on the referenced <wcs-debounce> / <wcs-throttle>.
  const DebounceCtor = customElements.get(config.tagNames.debounce);
  const ThrottleCtor = customElements.get(config.tagNames.throttle);
  const el = document.getElementById(id);
  if (!el) return;
  const isDebounce = DebounceCtor && el instanceof DebounceCtor;
  const isThrottle = ThrottleCtor && el instanceof ThrottleCtor;
  if (!isDebounce && !isThrottle) return;

  // Suppress the element's default action so a debounce can fire without
  // navigating. See README "Optional DOM Triggering".
  event.preventDefault();
  (el as unknown as Triggerable).trigger();
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

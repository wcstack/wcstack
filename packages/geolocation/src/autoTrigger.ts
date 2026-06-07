import { config } from "./config.js";
import type { WcsGeolocation } from "./components/Geolocation.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const geoId = triggerElement.getAttribute(config.triggerAttribute);
  if (!geoId) return;

  // Resolve the registered constructor at call time instead of importing
  // Geolocation as a value. The value import created a components/Geolocation.ts
  // ⇄ autoTrigger.ts cycle (Geolocation.connectedCallback() calls
  // registerAutoTrigger()). instanceof against the customElements registry keeps
  // the exact same identity guarantee — only the registered <wcs-geo> class
  // matches — without the import cycle.
  const GeoCtor = customElements.get(config.tagNames.geo);
  const geoElement = document.getElementById(geoId);
  if (!GeoCtor || !(geoElement instanceof GeoCtor)) return;

  // Suppress the element's default action so a fix can be requested without
  // navigating. Intentional: do not attach data-geotarget to an element whose
  // default action you also want (real <a href> link, form-submit button) — it
  // will be cancelled. See README "Optional DOM Triggering".
  event.preventDefault();
  (geoElement as WcsGeolocation).getCurrentPosition();
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

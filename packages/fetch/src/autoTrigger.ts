import { config } from "./config.js";
import type { Fetch } from "./components/Fetch.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const fetchId = triggerElement.getAttribute(config.triggerAttribute);
  if (!fetchId) return;

  // Resolve the registered constructor at call time instead of importing Fetch
  // as a value. The value import created a components/Fetch.ts ⇄ autoTrigger.ts
  // cycle (Fetch.connectedCallback() calls registerAutoTrigger()). instanceof
  // against the customElements registry keeps the exact same identity guarantee
  // — only the registered <wcs-fetch> class matches — without the import cycle.
  const FetchCtor = customElements.get(config.tagNames.fetch);
  const el = document.getElementById(fetchId);
  if (!FetchCtor || !(el instanceof FetchCtor)) return;
  const fetchElement = el as Fetch;

  // Skip when the target has no url. fetch() is fire-and-forget here (its returned
  // promise is intentionally not awaited), and FetchCore.fetch() rejects synchronously
  // on an empty url. Without this guard that rejection would surface as an unhandled
  // promise rejection. Treat a url-less target as "nothing to do", consistent with the
  // other early returns above.
  if (!fetchElement.url) return;

  // Suppress the element's default action so a fetch can fire without navigating.
  // Intentional: do not attach data-fetchtarget to an element whose default action
  // you also want (real <a href> link, form-submit button) — it will be cancelled.
  // See README "Optional DOM Triggering".
  event.preventDefault();
  fetchElement.fetch();
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

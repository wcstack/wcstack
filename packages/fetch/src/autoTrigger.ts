import { config } from "./config.js";
import { Fetch } from "./components/Fetch.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const fetchId = triggerElement.getAttribute(config.triggerAttribute);
  if (!fetchId) return;

  const fetchElement = document.getElementById(fetchId) as Fetch | null;
  if (!fetchElement || !(fetchElement instanceof Fetch)) return;

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

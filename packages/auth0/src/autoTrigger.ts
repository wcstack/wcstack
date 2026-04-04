import { config } from "./config.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const authId = triggerElement.getAttribute(config.triggerAttribute);
  if (!authId) return;

  const authElement = document.getElementById(authId);
  if (!authElement || authElement.tagName.toLowerCase() !== config.tagNames.auth) return;

  event.preventDefault();
  (authElement as any).login();
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

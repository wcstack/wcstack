import { config } from "./config.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const aiId = triggerElement.getAttribute(config.triggerAttribute);
  if (!aiId) return;

  const aiElement = document.getElementById(aiId);
  if (!aiElement || aiElement.tagName.toLowerCase() !== config.tagNames.ai) return;

  event.preventDefault();
  (aiElement as any).send();
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

import { config } from "./config.js";
import { Storage } from "./components/Storage.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const storageId = triggerElement.getAttribute(config.triggerAttribute);
  if (!storageId) return;

  const storageElement = document.getElementById(storageId) as Storage | null;
  if (!storageElement || !(storageElement instanceof Storage)) return;

  event.preventDefault();
  storageElement.save();
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

import { config } from "./config.js";
import type { Storage } from "./components/Storage.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const storageId = triggerElement.getAttribute(config.triggerAttribute);
  if (!storageId) return;

  // Resolve the registered constructor at call time instead of importing Storage
  // as a value. The value import created a components/Storage.ts ⇄ autoTrigger.ts
  // cycle (Storage.connectedCallback() calls registerAutoTrigger()). instanceof
  // against the customElements registry keeps the exact same identity guarantee
  // — only the registered <wcs-storage> class matches — without the import cycle.
  const StorageCtor = customElements.get(config.tagNames.storage);
  const storageElement = document.getElementById(storageId);
  if (!StorageCtor || !(storageElement instanceof StorageCtor)) return;

  event.preventDefault();
  (storageElement as Storage).save();
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

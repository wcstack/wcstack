import { config } from "./config.js";
import type { WcsWebSocket } from "./components/WebSocket.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const wsId = triggerElement.getAttribute(config.triggerAttribute);
  if (!wsId) return;

  // Resolve the registered constructor at call time instead of importing
  // WcsWebSocket as a value. The value import created a components/WebSocket.ts ⇄
  // autoTrigger.ts cycle (WcsWebSocket.connectedCallback() calls
  // registerAutoTrigger()). instanceof against the customElements registry keeps
  // the exact same identity guarantee — only the registered <wcs-ws> class
  // matches — without the import cycle.
  const WsCtor = customElements.get(config.tagNames.ws);
  const wsElement = document.getElementById(wsId);
  if (!WsCtor || !(wsElement instanceof WsCtor)) return;

  event.preventDefault();
  (wsElement as WcsWebSocket).connect();
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

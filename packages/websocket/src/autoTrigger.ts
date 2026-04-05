import { config } from "./config.js";
import { WcsWebSocket } from "./components/WebSocket.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const wsId = triggerElement.getAttribute(config.triggerAttribute);
  if (!wsId) return;

  const wsElement = document.getElementById(wsId) as WcsWebSocket | null;
  if (!wsElement || !(wsElement instanceof WcsWebSocket)) return;

  event.preventDefault();
  wsElement.connect();
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

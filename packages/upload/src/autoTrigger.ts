import { config } from "./config.js";
import { WcsUpload } from "./components/Upload.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const uploadId = triggerElement.getAttribute(config.triggerAttribute);
  if (!uploadId) return;

  const uploadElement = document.getElementById(uploadId) as WcsUpload | null;
  if (!uploadElement || !(uploadElement instanceof WcsUpload)) return;

  // ファイルと URL が揃っている場合のみ既定動作を抑止
  if (uploadElement.files && uploadElement.files.length > 0 && uploadElement.url) {
    event.preventDefault();
  }
  uploadElement.upload();
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

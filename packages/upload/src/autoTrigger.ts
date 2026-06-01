import { config } from "./config.js";
import type { WcsUpload } from "./components/Upload.js";

let registered = false;

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const triggerElement = target.closest<Element>(`[${config.triggerAttribute}]`);
  if (!triggerElement) return;

  const uploadId = triggerElement.getAttribute(config.triggerAttribute);
  if (!uploadId) return;

  // Resolve the registered constructor at call time instead of importing WcsUpload
  // as a value. The value import created a components/Upload.ts ⇄ autoTrigger.ts
  // cycle (WcsUpload.connectedCallback() calls registerAutoTrigger()). instanceof
  // against the customElements registry keeps the exact same identity guarantee
  // — only the registered <wcs-upload> class matches — without the import cycle.
  const UploadCtor = customElements.get(config.tagNames.upload);
  const el = document.getElementById(uploadId);
  if (!UploadCtor || !(el instanceof UploadCtor)) return;
  const uploadElement = el as WcsUpload;

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

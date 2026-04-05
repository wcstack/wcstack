import { WcsUpload } from "./components/Upload.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.upload)) {
    customElements.define(config.tagNames.upload, WcsUpload);
  }
}

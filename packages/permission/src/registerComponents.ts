import { WcsPermission } from "./components/Permission.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.permission)) {
    customElements.define(config.tagNames.permission, WcsPermission);
  }
}

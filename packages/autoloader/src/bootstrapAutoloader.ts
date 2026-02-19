import { setConfig } from "./config.js";
import { registerComponents } from "./registerComponents.js";
import { IWritableConfig } from "./types.js";

export function bootstrapAutoloader(config?: IWritableConfig): void {
  if (config) {
    setConfig(config);
  }
  registerComponents();
}

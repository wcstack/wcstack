import { setConfig } from "./config.js";
import { config } from "./config.js";
import { registerComponents } from "./registerComponents.js";
import { registerAutoTrigger } from "./autoTrigger.js";
import { IWritableConfig } from "./types.js";

export function bootstrapFetch(userConfig?: IWritableConfig): void {
  if (userConfig) {
    setConfig(userConfig);
  }
  registerComponents();
  if (config.autoTrigger) {
    registerAutoTrigger();
  }
}

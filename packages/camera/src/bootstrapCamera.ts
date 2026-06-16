import { setConfig } from "./config.js";
import { registerComponents } from "./registerComponents.js";
import { IWritableConfig } from "./types.js";

export function bootstrapCamera(userConfig?: IWritableConfig): void {
  if (userConfig) {
    setConfig(userConfig);
  }
  registerComponents();
}

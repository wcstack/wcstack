import { setConfig } from "./config.js";
import { registerComponents } from "./registerComponents.js";
import { IWritableConfig } from "./types.js";

export function bootstrapCredential(userConfig?: IWritableConfig, registry?: CustomElementRegistry): void {
  if (userConfig) {
    setConfig(userConfig);
  }
  registerComponents(registry);
}

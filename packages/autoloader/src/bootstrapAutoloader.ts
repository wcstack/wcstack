import { setConfig } from "./config.js";
import { registerHandler } from "./registerHandler.js";
import { IWritableConfig } from "./types.js";

export async function bootstrapAutoloader(config?: Partial<IWritableConfig>): Promise<void> {
  if (config) {
    setConfig(config);
  }
  await registerHandler();
}
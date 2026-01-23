import { IWritableConfig } from "./types";
import { setConfig } from "./config";
import { registerComponents } from "./registerComponents";

/**
 * Initialize the router with optional configuration.
 * This is the main entry point for setting up the router.
 * @param config - Optional partial configuration to override defaults
 */
export function bootstrapRouter(config?: Partial<IWritableConfig>): void {
  if (config) {
    setConfig(config);
  }
  registerComponents();
}

import { setConfig } from "./config";
import { registerComponents } from "./registerComponents";
import { IWritableConfig } from "./types";

export function bootstrapState(config?: IWritableConfig): void {
  if (config) {
    setConfig(config);
  }
  registerComponents();
}
import { setConfig } from "./config";
import { registerDevtoolsSource } from "./devtools/bridge";
import { registerComponents } from "./registerComponents";
import { IWritableConfig } from "./types";

export function bootstrapState(config?: IWritableConfig, registry?: CustomElementRegistry): void {
  if (config) {
    setConfig(config);
  }
  registerComponents(registry);
  // DevTools Hook Protocol への source 登録（SSR では no-op・冪等）
  registerDevtoolsSource();
}
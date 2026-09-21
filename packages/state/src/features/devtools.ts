/**
 * features/devtools.ts — DevTools Hook Protocol への source 登録（@wcstack/state/features/devtools）。
 */
import type { IStateFeature } from "../core/features";
import { registerDevtoolsSource } from "../devtools/bridge";

export const devtools: IStateFeature = {
  name: "devtools",
  install(): void {
    registerDevtoolsSource();
  },
};
export default devtools;

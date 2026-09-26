/**
 * The DevTools add-on (@wcstack/state/features/devtools): `@wcstack/devtools` over the hook
 * protocol v2 — see src/devtools/devtools.ts.
 */
import { addHook, type Feature } from "../hooks";
import { devtoolsDrained, devtoolsElement, devtoolsFailed, devtoolsWritten, registerSource } from "../devtools/devtools";

export const devtools: Feature = {
  name: "devtools",
  install(): void {
    addHook("element", devtoolsElement);
    addHook("written", devtoolsWritten);
    addHook("drained", devtoolsDrained);
    addHook("failed", devtoolsFailed);
    registerSource();
  },
};
export default devtools;

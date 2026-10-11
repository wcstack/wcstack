/**
 * The DevTools add-on (@wcstack/state/features/devtools): `@wcstack/devtools` over the hook
 * protocol v2 — see src/devtools/devtools.ts.
 */
import { chain, hooks, type Feature } from "../hooks";
import { devtoolsDrained, devtoolsElement, devtoolsFailed, devtoolsWritten, registerSource } from "../devtools/devtools";

export const devtools: Feature = {
  name: "devtools",
  install(): void {
    hooks.element = chain(hooks.element, devtoolsElement);
    hooks.written = chain(hooks.written, devtoolsWritten);
    hooks.drained = chain(hooks.drained, devtoolsDrained);
    hooks.failed = chain(hooks.failed, devtoolsFailed);
    registerSource();
  },
};
export default devtools;

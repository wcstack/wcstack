/**
 * The recursion add-on (@wcstack/state/features/recursion): `$recursion` and `**` — see
 * src/recursion/recursion.ts.
 */
import { chain, first, handled, hooks, type Feature } from "../hooks";
import { declareRecursion, guardExpansion, recursionSettled } from "../recursion/recursion";

export const recursion: Feature = {
  name: "recursion",
  install(): void {
    hooks.declare = chain(hooks.declare, declareRecursion);
    hooks.element = chain(hooks.element, (engine, phase) => {
      if (phase === "mounting" || phase === "reset") recursionSettled(engine);
    });
    hooks.beforeWrite = first(handled, hooks.beforeWrite, guardExpansion);
  },
};
export default recursion;

/**
 * The recursion add-on (@wcstack/state/features/recursion): `$recursion` and `**` — see
 * src/recursion/recursion.ts.
 */
import { addHook, type Feature } from "../hooks";
import { declareRecursion, guardExpansion, recursionSettled } from "../recursion/recursion";

export const recursion: Feature = {
  name: "recursion",
  install(): void {
    addHook("declare", declareRecursion);
    addHook("element", (engine, phase) => {
      if (phase === "mounting" || phase === "reset") recursionSettled(engine);
    });
    addHook("beforeWrite", guardExpansion);
  },
};
export default recursion;

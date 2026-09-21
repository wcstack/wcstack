/**
 * features/recursion.ts — `$recursion` と `**`（@wcstack/state/features/recursion）。
 */
import type { IStateFeature } from "../core/features";
import { installRecursionDeclarations } from "../recursion/declarations";

export const recursion: IStateFeature = {
  name: "recursion",
  install(): void {
    installRecursionDeclarations();
  },
};
export default recursion;

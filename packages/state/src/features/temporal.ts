/**
 * features/temporal.ts — `$watch` / `$scan` / `$streams`（@wcstack/state/features/temporal）。
 */
import type { IStateFeature } from "../core/features";
import { installScanDeclarations } from "../scan/declarations";
import { installStreamRuntime } from "../stream/streamRuntime";
import { installWatchRuntime } from "../watch/watchRuntime";

export const temporal: IStateFeature = {
  name: "temporal",
  install(): void {
    installWatchRuntime();
    installScanDeclarations();
    installStreamRuntime();
  },
};
export default temporal;

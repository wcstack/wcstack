/**
 * features/diagnostics.ts — 開発時の診断（@wcstack/state/features/diagnostics）。
 * 束縛・`$watch`・`$scan` のパスが state に無いときの console.warn（did-you-mean 付き）。
 * 入れなければ何も出さない — `@wcstack/state/core` だけの本番ページの軽量形。
 */
import type { IStateFeature } from "../core/features";
import { installDiagnostics } from "../diagnostics/install";

export const diagnostics: IStateFeature = {
  name: "diagnostics",
  install(): void {
    installDiagnostics();
  },
};
export default diagnostics;

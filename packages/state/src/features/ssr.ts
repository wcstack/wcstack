/**
 * features/ssr.ts — サーバー描画とハイドレーション（@wcstack/state/features/ssr）。
 */
import type { IStateFeature } from "../core/features";
import { installSsr } from "../ssr/install";

export const ssr: IStateFeature = {
  name: "ssr",
  install(): void {
    installSsr();
  },
};
export default ssr;

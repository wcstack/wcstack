/**
 * features/scopes.ts — `bind-component` のマウント・`mount=` のボリューム・オーバーレイ・DCC
 * （@wcstack/state/features/scopes）。要素のスコープを作る機能をひとまとめにする。
 */
import type { IStateFeature } from "../core/features";
import { installDccLifecycle } from "../dcc/dccLifecycle";
import { installVolumeGraft } from "../webComponent/volume";

export const scopes: IStateFeature = {
  name: "scopes",
  install(): void {
    // 接ぎ木の実体・スコープの hook・ボリューム / bind-component のライフサイクル
    installVolumeGraft();
    installDccLifecycle();
  },
};
export default scopes;

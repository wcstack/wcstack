/**
 * ssr/install.ts — SSR 機能の install（設計案 H8、S5）。core の受け口（core/ssrHooks.ts と
 * registerComponents の definer）へこの機能の実装を置き、ssr-snapshot プロトコルを提供する。
 * 従来 `State` と `stateElementByName` と `registerComponents` に直書きされていた分岐で、
 * 理由のコメントは元の位置から移してある。
 */
import { config } from "../config";
import type { IStateElement } from "../components/types";
import { ISsrHooks, setSsrHooks } from "../core/ssrHooks";
import { registerComponentDefiner } from "../registerComponents";
import { getBindingsReady } from "../stateElementByName";
import { VERSION } from "../version";
import { registerSsrSnapshotBuilder } from "./buildSsrDocument";
import { hydrateBindings } from "./hydrateBindings";
import { Ssr } from "./Ssr";

export const ssrFeatureHooks: ISsrHooks = {
  hydrate: hydrateBindings,
  loadState(element) {
    const root = element.parentNode;
    if (!root) return null;
    const ssrEl = Ssr.find(root);
    if (!ssrEl) return null;
    const data = ssrEl.stateData;
    return Object.keys(data).length > 0 ? data : null;
  },
  async emitSnapshot(element) {
    await getBindingsReady((element as unknown as IStateElement).rootNode);
    const stateData = Ssr.extractStateData(element);
    const ssrEl = document.createElement(config.tagNames.ssr);
    ssrEl.setAttribute("version", VERSION);
    // スナップショットの範囲はこの state のツリー — モジュール寿命の台帳に残った
    // 別のレンダリングのテンプレートを載せない（リクエスト間のデータ漏れ）
    Ssr.buildContent(ssrEl, stateData, (element as unknown as IStateElement).rootNode);
    element.parentNode?.insertBefore(ssrEl, element);
  },
};

let installed = false;
/** 冪等。full / auto では `bootstrapState()` が呼ぶ */
export function installSsr(): void {
  if (installed) return;
  installed = true;
  setSsrHooks(ssrFeatureHooks);
  registerComponentDefiner((registry) => {
    if (!registry.get(config.tagNames.ssr)) {
      registry.define(config.tagNames.ssr, Ssr);
    }
  });
  // ssr-snapshot プロトコルの提供（docs/ssr-router-design.md §5）。renderToString が
  // `<wcs-ssr>` 生成をサーバー主導の最終パスへ回せるようにする。登録は冪等
  registerSsrSnapshotBuilder();
}

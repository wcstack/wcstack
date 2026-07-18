import { IInitialSyncPolicy, resolveInitialSyncPolicy } from "../bindings/initialSync";
import { config } from "../config";
import { INDEX_BY_INDEX_NAME } from "../define";
import { isPossibleTwoWay } from "../event/isPossibleTwoWay";
import { getCustomElement } from "../getCustomElement";
import { IBindingInfo } from "../types";
import { resolveNodePath } from "./resolveNodePath";
import { IFragmentInfo, IRowPlan, IRowPlanSlot } from "./types";

/**
 * rowPlan.ts — 行実体化プランのコンパイル（docs/state-row-instantiation-redesign.md §3-1）。
 *
 * テンプレート（fragmentInfo）を初回行生成時に一度だけ検査し、全スロットが
 * 「行不変の判定をテンプレート時に確定できる」種別のときだけプランを返す。
 * 1 スロットでも確定できなければ null（テンプレート丸ごと従来経路 = 部分適用しない。
 * 経路混在のデバッグ困難を避ける設計判断・同 §5）。
 *
 * プラン適格の条件（すべて満たすこと）:
 *  - bindingType が text / prop / event のみ（構造 for/if・radio/checkbox・spread は不適格）
 *  - バインディング先ノードがカスタム要素でない（定義待ち・wcBindable 検証が不要）
 *  - prop が command / eventToken 名前空間でない（token 配線 teardown が要るため）
 *  - prop が双方向可能（isPossibleTwoWay）でない（connect-snapshot / observer 配線が要るため）
 *  - initial-sync policy が観測不要（observable=false）かつ authority が "auto" でない
 *  - text スロットは事前正規化済みの Text ノードである
 */
export function compileRowPlan(fragmentInfo: IFragmentInfo): IRowPlan | null {
  const directional = config.enableDirectionalInitialSync;
  const slots: IRowPlanSlot[] = [];
  const nodeInfos = fragmentInfo.nodeInfos;
  for (let nodeIndex = 0; nodeIndex < nodeInfos.length; nodeIndex++) {
    const nodeInfo = nodeInfos[nodeIndex];
    const node = resolveNodePath(fragmentInfo.fragment, nodeInfo.nodePath);
    if (node === null) {
      return null;
    }
    for (const template of nodeInfo.parseBindTextResults) {
      const bindingType = template.bindingType;
      if (bindingType !== "text" && bindingType !== "prop" && bindingType !== "event") {
        return null;
      }
      // command.<name>（prop 扱い）と eventToken.<prop>（event 扱い）は token 配線の
      // teardown / attach 分岐が要るため不適格
      const namespace = template.propSegments[0];
      if (namespace === "command" || namespace === "eventToken") {
        return null;
      }
      if (bindingType === "text") {
        if (node.nodeType !== Node.TEXT_NODE) {
          return null;
        }
      } else if (getCustomElement(node) !== null) {
        return null;
      }
      if (bindingType === "prop" && isPossibleTwoWay(node, template.propName)) {
        return null;
      }
      let policy: IInitialSyncPolicy;
      try {
        // 判定はテンプレートのノードで行う（policy は node の宣言と行不変フィールドの
        // 純関数）。修飾子エラー等の throw は不適格として従来経路に倒し、従来経路が
        // 同じエラーを同じタイミング（初回行生成）で報告する。
        const probe: IBindingInfo = { ...template, node, replaceNode: node };
        policy = resolveInitialSyncPolicy(probe);
      } catch {
        return null;
      }
      if (policy.observable || policy.authority === "auto") {
        return null;
      }
      slots.push({
        nodeIndex,
        template,
        isEvent: bindingType === "event",
        isIndexBinding: template.statePathName in INDEX_BY_INDEX_NAME,
        policy,
        authority: policy.authority,
      });
    }
  }
  return { directional, slots };
}

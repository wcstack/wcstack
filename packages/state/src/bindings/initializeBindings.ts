import { ILoopContext } from "../list/types";
import { IBindingInfo } from "../types";
import { INDEX_BY_INDEX_NAME } from "../define";
import {
  collectNodesAndBindingInfos,
  collectNodesAndBindingInfosByFragment,
  IDeferredSpreadEntry,
  ParseResultTransform,
  processDeferredNode,
} from "./collectNodesAndBindingInfos";
import { IFragmentNodeInfo, IRowPlan } from "../structural/types";
import { setLoopContextByNode } from "../list/loopContextByNode";
import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { IInitialBindingInfo } from "./types";
import { BindingSession, getOrCreateBindingSession } from "./BindingSession";

/**
 * 未定義カスタム要素への `...: path` を `whenDefined` 後の配線として予約する。
 * ハイドレーション経路（`ssr/hydrateBindings.ts`）も同じ手順を通すため export している —
 * あちらは `collectNodesAndBindingInfos` の 3 要素目を捨てていて、SSR したページでだけ
 * spread が永久に配線されなかった。
 *
 * `contentBindings` は構造テンプレートの行（Content）の束縛の列（#330。`activateContent` が渡す）。
 * 行の待ちは行の解体（session の dispose）が取り消し、次の活性化（プールからの使い回し・`if:` の
 * 再表示）が予約し直す。定義されたら展開した束縛をこの列に足して行の束縛にし（以後の解体・活性化は
 * 他の束縛と同じ）、`deferredSpreads` から外す — 展開は一度きり。添字の束縛（`$1`）は `indexBindings`
 * （行の添字が変わったときに当て直す列）にも足す — createContent の振り分けと同じ。
 */
export function scheduleDeferredSpreads(
  deferredSpreads: IDeferredSpreadEntry[],
  parentLoopContext: ILoopContext | null,
  session: BindingSession,
  contentBindings?: IBindingInfo[],
  indexBindings?: IBindingInfo[],
): void {
  for (const entry of deferredSpreads) {
    // 生きている行の活性化し直し（`if:` の真→真）で待ちを重ねない（取り消し済み・発火済みなら何もしない）
    entry.cancel?.();
    entry.cancel = session.deferUntilDefined(entry.node, entry.tagName, () => {
      const bindings = processDeferredNode(entry);
      if (contentBindings) {
        deferredSpreads.splice(deferredSpreads.indexOf(entry), 1);
        contentBindings.push(...bindings);
        indexBindings!.push(...bindings.filter((binding) => binding.statePathName in INDEX_BY_INDEX_NAME));
      }
      if (bindings.length === 0) return;
      setLoopContextByNode(entry.node, parentLoopContext);
      // 行の束縛は行と同じ選択肢で（createContent の初期化 → activate の昇格と同じ結果）
      const initialized = session.initialize(bindings, contentBindings && { registerPathInfo: false, applyOnReconnect: false });
      applyChangeFromBindings(initialized);
    }, (error: unknown) => {
      console.error(`[@wcstack/state] deferred spread failed for <${entry.tagName}>.`, error);
    });
  }
}

export function initializeBindings(
  root: Document | DocumentFragment | Element,
  parentLoopContext: ILoopContext | null,
  transform?: ParseResultTransform,
): void {
  const [subscriberNodes, allBindings, deferredSpreads] = collectNodesAndBindingInfos(root, transform);
  const session = getOrCreateBindingSession(root);
  for (const node of subscriberNodes) {
    setLoopContextByNode(node, parentLoopContext);
  }
  const initialized = session.initialize(allBindings);
  applyChangeFromBindings(initialized);
  scheduleDeferredSpreads(deferredSpreads, parentLoopContext, session);
}

export function initializeBindingsByFragment(
  root: DocumentFragment,
  nodeInfos: IFragmentNodeInfo[],
): IInitialBindingInfo {
  const [subscriberNodes, allBindings, spreads] = collectNodesAndBindingInfosByFragment(root, nodeInfos);
  const session = new BindingSession();
  // knownRoot=null: detached fragment 上の初期化。observableRootFor が必ず null を
  // 返す（observe は no-op）ため、binding ごとの getRootNode を省略する
  const initialized = session.initialize(allBindings, {
    registerAddress: false,
    applyOnReconnect: false,
  }, null);
  return {
    nodes: subscriberNodes,
    bindingInfos: initialized,
    bindingSession: session,
    spreads,
  };
}

/**
 * RowPlan 経路の行初期化（createContent 専用）。remember / spread 展開 /
 * shouldApplyState フィルタを経ず、プランのスロットから直接 record を構築する。
 * 返す session は従来経路と同じ活性化（activate）・破棄（dispose/wholesale）
 * インターフェースを持つ。
 */
// `for` 束縛（そのノード）ごとに 1 つの session を全行で共有する（設計 R3）。
// プランが差し替わったら（再セット・方向性初期同期の設定変更）新しい session に切り替える。
const rowSessionByForNode = new WeakMap<Node, BindingSession>();
export function initializeRowBindings(plan: IRowPlan, bindings: IBindingInfo[], forNode: Node): BindingSession {
  let session = rowSessionByForNode.get(forNode);
  if (typeof session === "undefined" || session.currentRowPlan !== plan) {
    session = new BindingSession();
    rowSessionByForNode.set(forNode, session);
  }
  session.initializeRow(plan, bindings);
  return session;
}

/**
 * recursion/materialize.ts
 *
 * 「具体パスを読む直前に、その深さの再帰 getter を生やす」入口。
 * 呼び手は `getByAddress`（キャッシュ参照前）だけで、宣言の無い state は
 * 呼び出し元の boolean 判定で弾かれるのでここまで来ない。
 */

import { IStateElement } from "../components/types";

/**
 * `path` がこの state の再帰 getter の展開形なら、未登録の深さを実体化する。
 * 該当しないパス（＝大多数）は接頭辞比較 1 回で戻る。
 */
export function materializeRecursionAccessor(stateElement: IStateElement, path: string): void {
  const registry = stateElement.recursionRegistry;
  if (registry === null || typeof registry === "undefined" || !registry.hasDefinitions) {
    return;
  }
  // 早期 return は「この世代で生やしたか」で見る。`getterPaths` で見ると、前世代の
  // 生成物が state オブジェクトに残っている再セット後に `listPaths` の登録だけが
  // 抜け落ちる（getStateInfo が具体パスを getterPaths へ復元するため）。
  if (registry.isMaterialized(path)) {
    return;
  }
  registry.materializeFor(stateElement, path);
}

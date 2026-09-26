/**
 * updatedCallback.ts
 *
 * Utility function to invoke the StateClass lifecycle hook "$updatedCallback".
 *
 * Main responsibilities:
 * - Invokes $updatedCallback method if defined on the object (target)
 * - Callback is invoked with target's this context, passing IReadonlyStateProxy (receiver) as argument
 * - Executable as async function (await compatible)
 *
 * Design points:
 * - Safely retrieves $updatedCallback property using Reflect.get
 * - Does nothing if the callback doesn't exist
 * - Used for lifecycle management and update handling logic
 */

import { IAbsoluteStateAddress } from "../../address/types";
import { STATE_RENDERED_CALLBACK_NAME } from "../../define";
import { getScopedIndexes } from "../../list/wildcardLevel";
import { IStateHandler } from "../types";

/**
 * Invokes the $updatedCallback lifecycle hook if defined on the target.
 * Aggregates updated paths and their indexes before passing to the callback.
 * @param target - Target object to check for callback
 * @param refs - Array of state property references that were updated
 * @param receiver - State proxy to pass as this context
 * @param handler - State handler (unused but part of signature)
 * @returns Promise or void depending on callback implementation
 */
export function updatedCallback(
  target: object,
  refs: IAbsoluteStateAddress[],
  receiver: any,
  handler: IStateHandler
): unknown {
  const callback: unknown = Reflect.get(target, STATE_RENDERED_CALLBACK_NAME);
  let result: unknown;
  if (typeof callback === "function") {
    const paths: Set<string> = new Set();
    // ToDo:現状では1階層のみのワイルドカードに対応。多階層対応は後回し
    const indexesListByPath: Record<string, Array<number[]>> = {};
    for (const ref of refs) {
      // v2: ルートに 1 ツリー。他ツリー（別ルート）の ref はこの state の相対語彙で
      // 表せないので配送しない（v1 の `path@name` 合成は名前次元と一緒に消えた）
      if (ref.absolutePathInfo.stateElement !== handler.stateElement) {
        continue;
      }
      const pathInfo = ref.absolutePathInfo.pathInfo;
      const pathName = pathInfo.path;
      // D20/D21: マーカーパス（`#m<id>` セグメント = マウント私有キーの内部アドレス）は
      // マウントインスタンスの私有語彙。ルートの $updatedCallback へ素通しすると、
      // 作者に解釈不能で再初期化のたびに変わる内部 id が漏れるため配送しない
      // （`#` はパス文法で書けない文字 — ツリーパスとは構造的に衝突しない）。
      // 私有キーの可視化は devtools の overlays() 経由（プロトコル v2）。
      if (pathName.indexOf("#") !== -1) {
        continue;
      }
      paths.add(pathName);
      if (pathInfo.wildcardCount > 0) {
        const indexes = getScopedIndexes(ref.listIndex!, pathInfo.wildcardCount);
        const indexesList = indexesListByPath[pathName];
        if (typeof indexesList === "undefined") {
          indexesListByPath[pathName] = [indexes];
        } else {
          indexesList.push(indexes);
        }
      }
    }
    // 除いた結果が空の回（私有キーだけが更新された — マウントのメソッドが私有キーに書くたびに来る）は
    // 作者の語彙で何も更新されていないので呼ばない（#321）
    if (paths.size > 0 || refs.length === 0) {
      result = callback.call(receiver, Array.from(paths), indexesListByPath);
    }
  }
  // ルートのコールバックの**後**に配送する機能（ボリュームの相対 $updatedCallback — webComponent/addressHooks.ts）は
  // updated hook が受ける。hook の無い state は判定 1 個で抜ける
  const hooks = handler.stateElement?.addressHooks;
  if (hooks) {
    const updated = hooks.updated;
    for (let i = 0; i < updated.length; i++) {
      updated[i](handler.stateElement, refs, receiver);
    }
  }
  return result;
}
